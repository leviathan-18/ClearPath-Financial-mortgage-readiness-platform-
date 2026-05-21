import { jsPDF } from 'jspdf'
import { useEffect, useMemo, useState } from 'react'
import './App.css'

const stepMeta = [
  { id: 1, title: 'Overview', hint: 'Proposal summary' },
  { id: 2, title: 'Personal Info', hint: 'Basic client details' },
  { id: 3, title: 'Income Structure', hint: 'Income and obligations' },
  { id: 4, title: 'Credit + Eligibility', hint: 'Approval engine' },
  { id: 5, title: 'FAQ', hint: 'Client questions' },
]

const employmentOptions = [
  'Salaried',
  'Self-employed',
  'Business owner',
  'Entrepreneur',
  'Freelancer',
  'Unemployed',
]

const provinceOptions = [
  'Ontario',
  'British Columbia',
  'Alberta',
  'Quebec',
  'Manitoba',
  'Saskatchewan',
  'Nova Scotia',
  'New Brunswick',
  'Newfoundland and Labrador',
  'Prince Edward Island',
]

const initialForm = {
  name: '',
  age: '',
  maritalStatus: '',
  dependents: '',
  province: 'Ontario',
  employmentType: 'Salaried',
  monthlyIncome: '',
  savings: '',
  existingLoans: '',
  monthlyExpenses: '',
  yearsOfExperience: '',
  creditStrength: '',
  desiredLoanAmount: '',
  propertyBudget: '',
  downPayment: '',
}

function currency(value) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function numberOrZero(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeCreditStrength(value) {
  const score = numberOrZero(value)

  if (score <= 0) return 0
  if (score <= 100) return Math.round(300 + (score / 100) * 600)
  if (score >= 300 && score <= 900) {
    return Math.round(((score - 300) / 550) * 100)
  }

  return Math.max(300, Math.min(900, Math.round(score)))
}

function isValidCreditStrength(value) {
  const score = numberOrZero(value)
  return score >= 300 && score <= 900
}

function parseTrainingCompletion(completion) {
  const approvalMatch = completion.match(/ApprovalChance:\s*([0-9]+)%/i)
  const loanMatch = completion.match(/EstimatedLoan:\s*\$?([0-9,]+)/i)
  const riskMatch = completion.match(/Risk:\s*([A-Za-z]+)/i)

  return {
    approvalChance: approvalMatch ? `${approvalMatch[1]}%` : '—',
    estimatedLoan: loanMatch ? currency(Number(loanMatch[1].replace(/,/g, ''))) : '—',
    risk: riskMatch ? riskMatch[1] : '—',
  }
}

function sameFieldValue(left, right) {
  const leftValue = String(left ?? '').trim().toLowerCase()
  const rightValue = String(right ?? '').trim().toLowerCase()
  if (!leftValue && !rightValue) return true
  return leftValue === rightValue
}

function exampleDistance(form, example) {
  const numericWeights = {
    age: 1,
    dependents: 1,
    monthlyIncome: 0.004,
    savings: 0.001,
    existingLoans: 0.002,
    monthlyExpenses: 0.003,
    yearsOfExperience: 2,
    creditStrength: 0.35,
    desiredLoanAmount: 0.00001,
    propertyBudget: 0.00001,
    downPayment: 0.00001,
  }

  let distance = 0

  Object.entries(numericWeights).forEach(([key, weight]) => {
    const leftValue = key === 'creditStrength'
      ? normalizeCreditStrength(form[key])
      : numberOrZero(form[key])
    const rightValue = key === 'creditStrength'
      ? normalizeCreditStrength(example[key])
      : numberOrZero(example[key])
    distance += Math.abs(leftValue - rightValue) * weight
  })

  ;['maritalStatus', 'province', 'employmentType'].forEach((key) => {
    if (!sameFieldValue(form[key], example[key])) distance += 8
  })

  return distance
}

function lookupExampleResult(form, examples) {
  if (!Array.isArray(examples) || examples.length === 0) return null

  let bestExample = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const example of examples) {
    const exampleForm = example.input || {}
    const exactMatch = [
      'age',
      'maritalStatus',
      'dependents',
      'province',
      'employmentType',
      'monthlyIncome',
      'savings',
      'existingLoans',
      'monthlyExpenses',
      'yearsOfExperience',
      'creditStrength',
      'desiredLoanAmount',
      'propertyBudget',
      'downPayment',
    ].every((key) => sameFieldValue(form[key], exampleForm[key]))

    if (exactMatch) return parseTrainingCompletion(example.completion || '')

    const distance = exampleDistance(form, exampleForm)
    if (distance < bestDistance) {
      bestDistance = distance
      bestExample = example
    }
  }

  if (bestExample && bestDistance <= 35) {
    return parseTrainingCompletion(bestExample.completion || '')
  }

  return null
}

function validateStep(step, form) {
  const errors = {}

  if (step === 2) {
    if (!form.name.trim()) errors.name = 'Name is required.'
    if (!form.age || numberOrZero(form.age) < 18) errors.age = 'Age must be at least 18.'
    if (!form.maritalStatus.trim()) errors.maritalStatus = 'Marital status is required.'
    if (form.dependents === '') errors.dependents = 'Dependents is required.'
    if (!form.province.trim()) errors.province = 'Province is required.'
  }

  if (step === 3) {
    if (!form.employmentType.trim()) errors.employmentType = 'Employment type is required.'
    if (!form.monthlyIncome || numberOrZero(form.monthlyIncome) <= 0) errors.monthlyIncome = 'Monthly income is required.'
    if (form.savings === '') errors.savings = 'Savings are required.'
    if (form.existingLoans === '') errors.existingLoans = 'Existing loans are required.'
    if (form.monthlyExpenses === '') errors.monthlyExpenses = 'Monthly expenses are required.'
    if (form.yearsOfExperience === '' || numberOrZero(form.yearsOfExperience) < 0) errors.yearsOfExperience = 'Years of experience is required.'
  }

  if (step === 4) {
    if (!form.creditStrength || !isValidCreditStrength(form.creditStrength)) errors.creditStrength = 'Credit strength must be between 300 and 900.'
    if (!form.desiredLoanAmount || numberOrZero(form.desiredLoanAmount) <= 0) errors.desiredLoanAmount = 'Desired loan amount is required.'
    if (!form.propertyBudget || numberOrZero(form.propertyBudget) <= 0) errors.propertyBudget = 'Property budget is required.'
    if (form.downPayment === '') errors.downPayment = 'Down payment is required.'
  }

  return errors
}

function approvalEngine(form) {
  const income = numberOrZero(form.monthlyIncome)
  const creditStrength = normalizeCreditStrength(form.creditStrength)
  const debt = numberOrZero(form.existingLoans)
  const expenses = numberOrZero(form.monthlyExpenses)
  const savings = numberOrZero(form.savings)
  const downPayment = numberOrZero(form.downPayment)
  const desiredLoan = numberOrZero(form.desiredLoanAmount)
  const propertyBudget = numberOrZero(form.propertyBudget)
  const years = numberOrZero(form.yearsOfExperience)

  let approvalChance = creditStrength

  if (income > 10000) approvalChance += 8
  else if (income > 8000) approvalChance += 6
  else if (income > 6000) approvalChance += 5
  else if (income > 4500) approvalChance += 3
  else if (income > 3000) approvalChance += 1

  if (debt > 7000) approvalChance -= 8
  else if (debt > 3500) approvalChance -= 5
  else if (debt > 2000) approvalChance -= 3
  else if (debt > 0) approvalChance -= 1

  if (expenses > income * 0.75) approvalChance -= 10
  else if (expenses > income * 0.6) approvalChance -= 6
  else if (expenses > income * 0.5) approvalChance -= 3

  if (form.employmentType === 'Unemployed') approvalChance -= 20
  else if (form.employmentType === 'Salaried') approvalChance += 2
  else if (form.employmentType === 'Business owner') approvalChance += 2
  else if (form.employmentType === 'Self-employed') approvalChance += 1

  if (years >= 15) approvalChance += 4
  else if (years >= 5) approvalChance += 2
  else if (years < 1) approvalChance -= 10

  approvalChance = Math.max(5, Math.min(95, Math.round(approvalChance)))

  const estimatedLoan = approvalChance <= 25
    ? 0
    : Math.max(0, Math.min(desiredLoan, propertyBudget * 0.85, income * 72 + savings * 1.5 - debt * 2))
  const risk = approvalChance >= 80 ? 'Low' : approvalChance >= 55 ? 'Medium' : 'High'

  return {
    approvalChance: `${approvalChance}%`,
    estimatedLoan: currency(estimatedLoan),
    risk,
  }
}

function fieldError(errors, key) {
  return errors[key] ? <p className="field-error">{errors[key]}</p> : null
}

export default function App() {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState(initialForm)
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [eligibilityReady, setEligibilityReady] = useState(false)
  const [showResultModal, setShowResultModal] = useState(false)
  const [trainingExamples, setTrainingExamples] = useState([])

  const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000'
  const exampleResult = useMemo(() => lookupExampleResult(form, trainingExamples), [form, trainingExamples])
  const engineResult = useMemo(() => exampleResult || approvalEngine(form), [exampleResult, form])
  const strengthValue = normalizeCreditStrength(form.creditStrength)
  const eligibilityErrors = useMemo(() => validateStep(4, form), [form])
  const eligibilityComplete = Object.keys(eligibilityErrors).length === 0

  useEffect(() => {
    const controller = new AbortController()

    fetch(`${apiBaseUrl}/api/approval-examples`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load training examples.')
        return response.json()
      })
      .then((data) => {
        if (Array.isArray(data.examples)) {
          setTrainingExamples(data.examples)
        }
      })
      .catch(() => {
        setTrainingExamples([])
      })

    return () => controller.abort()
  }, [apiBaseUrl])

  useEffect(() => {
    setEligibilityReady(step === 4 && eligibilityComplete)
  }, [eligibilityComplete, step])

  const updateField = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    if (errors[name]) {
      setErrors((current) => {
        const next = { ...current }
        delete next[name]
        return next
      })
    }
  }

  const goNext = () => {
    const nextErrors = validateStep(step, form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setStep((current) => Math.min(4, current + 1))
  }

  const goBack = () => {
    setStatus('idle')
    setResult(null)
    setShowResultModal(false)
    setStep((current) => Math.max(1, current - 1))
  }

  const closeResultModal = () => setShowResultModal(false)

  const saveResultToDevice = () => {
    if (!result) return

    const record = {
      ...result,
      savedAt: new Date().toISOString(),
    }
    const fileName = `${(result.personalInfo?.name || 'proposal-record')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') || 'proposal-record'}-training.json`

    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const marginX = 14
    const marginTop = 16
    const contentWidth = pageWidth - marginX * 2
    const columnGap = 10
    const columnWidth = (contentWidth - columnGap) / 2
    let cursorY = marginTop

    const addHeading = (text, size = 18) => {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(size)
      pdf.setTextColor(15, 23, 42)
      pdf.text(text, marginX, cursorY)
      cursorY += size * 0.7 + 6
    }

    const addBody = (text, size = 11, lineGap = 5.6, font = 'helvetica', style = 'normal') => {
      pdf.setFont(font, style)
      pdf.setFontSize(size)
      pdf.setTextColor(30, 41, 59)
      const lines = pdf.splitTextToSize(text, columnWidth)
      pdf.text(lines, marginX, cursorY)
      cursorY += lines.length * lineGap + 4
    }

    const addSectionTitle = (text) => {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(12)
      pdf.setTextColor(15, 118, 110)
      pdf.text(text, marginX, cursorY)
      cursorY += 6
    }

    addHeading('Training-ready proposal record')
    addBody('Approval result summary and saved proposal data for client review.', 11, 5.5)

    pdf.setFillColor(15, 23, 42)
    pdf.roundedRect(marginX, cursorY, contentWidth, 34, 4, 4, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFont('helvetica', 'normal')

    const summaryColumns = [
      { label: 'Approval Chance', value: record.approvalEngine?.approvalChance || engineResult.approvalChance },
      { label: 'Estimated Loan', value: record.approvalEngine?.estimatedLoan || engineResult.estimatedLoan },
      { label: 'Risk', value: record.approvalEngine?.risk || engineResult.risk },
    ]

    summaryColumns.forEach((item, index) => {
      const columnX = marginX + (contentWidth / 3) * index + 4
      pdf.setFontSize(9)
      pdf.text(item.label.toUpperCase(), columnX, cursorY + 8)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(16)
      pdf.text(String(item.value), columnX, cursorY + 20)
      pdf.setFont('helvetica', 'normal')
    })

    cursorY += 42

    const sections = [
      {
        title: 'Personal info',
        lines: [
          `Name: ${record.personalInfo?.name || ''}`,
          `Age: ${record.personalInfo?.age || ''}`,
          `Marital Status: ${record.personalInfo?.maritalStatus || ''}`,
          `Dependents: ${record.personalInfo?.dependents || ''}`,
          `Province: ${record.personalInfo?.province || ''}`,
        ],
      },
      {
        title: 'Income structure',
        lines: [
          `Employment Type: ${record.incomeStructure?.employmentType || ''}`,
          `Monthly Income: ${currency(record.incomeStructure?.monthlyIncome || 0)}`,
          `Savings: ${currency(record.incomeStructure?.savings || 0)}`,
          `Existing Loans: ${currency(record.incomeStructure?.existingLoans || 0)}`,
          `Monthly Expenses: ${currency(record.incomeStructure?.monthlyExpenses || 0)}`,
          `Years of Experience: ${record.incomeStructure?.yearsOfExperience || ''}`,
        ],
      },
      {
        title: 'Credit eligibility',
        lines: [
          `Credit Strength: ${record.creditEligibility?.creditStrength || ''}%`,
          `Desired Loan Amount: ${currency(record.creditEligibility?.desiredLoanAmount || 0)}`,
          `Property Budget: ${currency(record.creditEligibility?.propertyBudget || 0)}`,
          `Down Payment: ${currency(record.creditEligibility?.downPayment || 0)}`,
        ],
      },
      {
        title: 'Result',
        lines: [
          `Approval Chance: ${record.approvalEngine?.approvalChance || engineResult.approvalChance}`,
          `Estimated Loan: ${record.approvalEngine?.estimatedLoan || engineResult.estimatedLoan}`,
          `Risk: ${record.approvalEngine?.risk || engineResult.risk}`,
          `Created At: ${record.createdAt || ''}`,
          `Saved To MongoDb: ${String(record.savedToMongoDb ?? false)}`,
          `Saved At: ${record.savedAt || ''}`,
        ],
      },
    ]

    const leftX = marginX
    const rightX = marginX + columnWidth + columnGap
    const sectionTop = cursorY

    sections.forEach((section, index) => {
      const sectionX = index % 2 === 0 ? leftX : rightX
      const sectionY = index < 2 ? sectionTop : sectionTop + 62
      pdf.setDrawColor(226, 232, 240)
      pdf.setFillColor(248, 250, 252)
      pdf.roundedRect(sectionX, sectionY, columnWidth, 56, 3, 3, 'FD')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(11)
      pdf.setTextColor(15, 118, 110)
      pdf.text(section.title.toUpperCase(), sectionX + 4, sectionY + 7)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.setTextColor(30, 41, 59)
      let lineY = sectionY + 14
      section.lines.forEach((line) => {
        const wrapped = pdf.splitTextToSize(line, columnWidth - 8)
        wrapped.forEach((wrappedLine) => {
          pdf.text(wrappedLine, sectionX + 4, lineY)
          lineY += 4.4
        })
      })
    })

    pdf.save(fileName.replace(/\.json$/i, '.pdf'))
    setShowResultModal(false)
  }

  const submitApplication = async (event) => {
    event.preventDefault()
    const nextErrors = validateStep(4, form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setStatus('saving')

    const payload = {
      personalInfo: {
        name: form.name.trim(),
        age: numberOrZero(form.age),
        maritalStatus: form.maritalStatus.trim(),
        dependents: numberOrZero(form.dependents),
        province: form.province,
      },
      incomeStructure: {
        employmentType: form.employmentType,
        monthlyIncome: numberOrZero(form.monthlyIncome),
        savings: numberOrZero(form.savings),
        existingLoans: numberOrZero(form.existingLoans),
        monthlyExpenses: numberOrZero(form.monthlyExpenses),
        yearsOfExperience: numberOrZero(form.yearsOfExperience),
      },
      creditEligibility: {
        creditStrength: numberOrZero(form.creditStrength),
        desiredLoanAmount: numberOrZero(form.desiredLoanAmount),
        propertyBudget: numberOrZero(form.propertyBudget),
        downPayment: numberOrZero(form.downPayment),
      },
      approvalEngine: engineResult,
      createdAt: new Date().toISOString(),
    }

    const immediateResult = {
      ...payload,
      approvalEngine: engineResult,
      savedToMongoDb: false,
    }

    setResult(immediateResult)
    setShowResultModal(true)

    try {
      const response = await fetch(`${apiBaseUrl}/api/applications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error('Failed to save application.')
      }

      const saved = await response.json()
      setResult({ ...immediateResult, ...saved, savedToMongoDb: true })
      setStatus('saved')
    } catch (error) {
      setStatus('offline')
    }
  }

  return (
    <div className="app-shell">
      <div className="app-backdrop" />
      <div className="app-container">
        <header className="hero-card">
          <div className="hero-copy">
            <div className="eyebrow">Canada mortgage intake</div>
            <h1>Locked-step application flow for client onboarding</h1>
            
          </div>

          <div className="hero-stats">
            <div><span>Clients</span><strong>{form.name ? '1' : '—'}</strong></div>
            <div><span>Region</span><strong>Canada</strong></div>
            <div><span>Mode</span><strong>Guided intake</strong></div>
        <div><span>Score range</span><strong>300-900</strong></div>
          </div>
        </header>

        <nav className="mini-steps" aria-label="Form steps">
          {stepMeta.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`mini-step ${s.id === step ? 'active' : ''} ${s.id < step ? 'complete' : ''}`}
              onClick={() => { if (s.id <= step) setStep(s.id) }}
            >
              {s.title}
            </button>
          ))}
        </nav>

        <main className="content-grid">
          <section className="form-card">
            {step === 1 && (
              <div className="form-grid">
                <div className="section-head">
                  <h2>Overview</h2>
                  <p>
                    A production-ready mortgage intake flow tailored for Canadian clients —
                    collects verified profile details, income evidence, and credit indicators,
                    and generates a concise, presentation-ready readiness report for advisors.
                  </p>
                </div>

                <div className="overview-grid">
                  <article className="overview-panel premium">
                    <div className="overview-label">What this does</div>
                    <h3>Structured intake and readiness report</h3>
                    <p>
                      Guides the client through verified data capture (profile, income, liabilities),
                      runs deterministic eligibility checks, and produces a compact advisor-facing
                      readiness summary suitable for underwriting handoff or client proposals.
                    </p>
                  </article>

                  <article className="overview-panel">
                    <div className="overview-label">Why it helps in production</div>
                    <ul>
                      <li>Localized choices (province, employment types) reduce client confusion.</li>
                      <li>Deterministic scoring provides consistent, auditable eligibility signals.</li>
                      <li>Locked progression improves data completeness and reduces follow-up.</li>
                      <li>Compact report output is ready for advisor review or downstream systems.</li>
                    </ul>
                  </article>

                  <article className="overview-panel">
                    <div className="overview-label">Process</div>
                    <ol>
                      <li>Overview (client guidance)</li>
                      <li>Personal Info (identity & contact)</li>
                      <li>Income Structure (verified income & expenses)</li>
                      <li>Credit + Eligibility (scoring & recommendation)</li>
                      <li>FAQ & next steps</li>
                    </ol>
                  </article>
                </div>

                <div className="action-row">
                  <button type="button" className="primary-btn" onClick={() => setStep(2)}>
                    Begin intake
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <form className="form-grid" onSubmit={(event) => { event.preventDefault(); goNext(); }}>
                <div className="section-head">
                  <h2>Personal Info</h2>
                  <p>Fill this page fully before the next page unlocks.</p>
                </div>

                <label>
                  <span>Name</span>
                  <input name="name" value={form.name} onChange={updateField} placeholder="John Doe" />
                  {fieldError(errors, 'name')}
                </label>

                <div className="two-col">
                  <label>
                    <span>Age</span>
                    <input name="age" type="number" value={form.age} onChange={updateField} placeholder="32" />
                    {fieldError(errors, 'age')}
                  </label>

                  <label>
                    <span>Dependents</span>
                    <input name="dependents" type="number" value={form.dependents} onChange={updateField} placeholder="2" />
                    {fieldError(errors, 'dependents')}
                  </label>
                </div>

                <div className="two-col">
                  <label>
                    <span>Marital Status</span>
                    <select name="maritalStatus" value={form.maritalStatus} onChange={updateField}>
                      <option value="">Select marital status</option>
                      <option value="Single">Single</option>
                      <option value="Married">Married</option>
                      <option value="Common Law">Common Law</option>
                      <option value="Divorced">Divorced</option>
                      <option value="Widowed">Widowed</option>
                    </select>
                    {fieldError(errors, 'maritalStatus')}
                  </label>

                  <label>
                    <span>Province</span>
                    <select name="province" value={form.province} onChange={updateField}>
                      {provinceOptions.map((province) => (
                        <option key={province} value={province}>{province}</option>
                      ))}
                    </select>
                    {fieldError(errors, 'province')}
                  </label>
                </div>

                <div className="action-row">
                  <button type="button" className="secondary-btn" onClick={goBack}>
                    Back to Overview
                  </button>
                  <button type="submit" className="primary-btn">
                    Continue to Income Structure
                  </button>
                </div>
              </form>
            )}

            {step === 3 && (
              <form className="form-grid" onSubmit={(event) => { event.preventDefault(); goNext(); }}>
                <div className="section-head">
                  <h2>Income Structure</h2>
                  <p>Use Canadian salary and expense values that reflect the applicant's real budget.</p>
                </div>

                <label>
                  <span>Employment Type</span>
                  <select name="employmentType" value={form.employmentType} onChange={updateField}>
                    {employmentOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  {fieldError(errors, 'employmentType')}
                </label>

                <div className="two-col">
                  <label>
                    <span>Monthly Income (CAD)</span>
                    <input name="monthlyIncome" type="number" value={form.monthlyIncome} onChange={updateField} placeholder="8500" />
                    {fieldError(errors, 'monthlyIncome')}
                  </label>

                  <label>
                    <span>Savings (CAD)</span>
                    <input name="savings" type="number" value={form.savings} onChange={updateField} placeholder="40000" />
                    {fieldError(errors, 'savings')}
                  </label>
                </div>

                <div className="two-col">
                  <label>
                    <span>Existing Loans (monthly CAD)</span>
                    <input name="existingLoans" type="number" value={form.existingLoans} onChange={updateField} placeholder="1200" />
                    {fieldError(errors, 'existingLoans')}
                  </label>

                  <label>
                    <span>Monthly Expenses (CAD)</span>
                    <input name="monthlyExpenses" type="number" value={form.monthlyExpenses} onChange={updateField} placeholder="3000" />
                    {fieldError(errors, 'monthlyExpenses')}
                  </label>
                </div>

                <label>
                  <span>Years of Experience</span>
                  <input name="yearsOfExperience" type="number" value={form.yearsOfExperience} onChange={updateField} placeholder="5" />
                  {fieldError(errors, 'yearsOfExperience')}
                </label>

                <div className="note-box">
                  <strong>Canada-specific guidance</strong>
                  <p>
                    Salaried and self-employed applicants are assessed differently. Keep the numbers realistic and in CAD.
                  </p>
                </div>

                <div className="action-row">
                  <button type="button" className="secondary-btn" onClick={goBack}>
                    Back
                  </button>
                  <button type="submit" className="primary-btn">
                    Continue to Credit + Eligibility
                  </button>
                </div>
              </form>
            )}

            {step === 4 && (
              <form className="form-grid" onSubmit={submitApplication}>
                <div className="section-head">
                  <h2>Credit + Eligibility</h2>
                  <p>We calculate approval chance with a simple engine. No bank APIs are needed.</p>
                </div>

                <div className="two-col">
                  <label>
                    <span>Approximate Credit Strength (Canada 300-900)</span>
                    <input name="creditStrength" type="number" value={form.creditStrength} onChange={updateField} placeholder="778" min="300" max="900" />
                    {fieldError(errors, 'creditStrength')}
                  </label>

                  <label>
                    <span>Desired Loan Amount (CAD)</span>
                    <input name="desiredLoanAmount" type="number" value={form.desiredLoanAmount} onChange={updateField} placeholder="500000" />
                    {fieldError(errors, 'desiredLoanAmount')}
                  </label>
                </div>

                <div className="two-col">
                  <label>
                    <span>Property Budget (CAD)</span>
                    <input name="propertyBudget" type="number" value={form.propertyBudget} onChange={updateField} placeholder="650000" />
                    {fieldError(errors, 'propertyBudget')}
                  </label>

                  <label>
                    <span>Down Payment (CAD)</span>
                    <input name="downPayment" type="number" value={form.downPayment} onChange={updateField} placeholder="65000" />
                    {fieldError(errors, 'downPayment')}
                  </label>
                </div>

                {!eligibilityComplete && (
                  <div className="loading-strip" aria-live="polite">
                    <span className="spinner" aria-hidden="true" />
                    <div>
                      <strong>Loading eligibility check</strong>
                      <p>Fill all Credit + Eligibility fields to unlock submit.</p>
                    </div>
                  </div>
                )}

                {eligibilityComplete && !eligibilityReady && (
                  <div className="loading-strip" aria-live="polite">
                    <span className="spinner" aria-hidden="true" />
                    <div>
                      <strong>Preparing submit</strong>
                      <p>Checking the loan profile and building the proposal record.</p>
                    </div>
                  </div>
                )}

                <div className="action-row">
                  <button type="button" className="secondary-btn" onClick={goBack}>
                    Back
                  </button>
                    <button type="submit" className="primary-btn" disabled={status === 'saving' || !eligibilityReady}>
                      {status === 'saving' ? 'Saving...' : 'Submit proposal'}
                  </button>
                </div>

                  {status === 'saved' && result && (
                    <div className="success-box">
                      Saved successfully. You can review the result window and submit again after editing the fields.
                    </div>
                  )}

                  {status === 'offline' && result && (
                    <div className="warning-box">
                      Save failed; the proposal data is still visible in the result window and can be retried.
                    </div>
                  )}
              </form>
            )}

            {step === 5 && (
              <div className="form-grid">
                <div className="section-head">
                  <h2>FAQ</h2>
                  <p>Common questions your client may ask before approval.</p>
                </div>

                <div className="faq-list">
                  <article>
                    <h3>Why is credit shown as a percentage?</h3>
                    <p>The proposal now uses a score strength meter so the client sees progress more intuitively.</p>
                  </article>
                  <article>
                    <h3>Can the data still be saved?</h3>
                    <p>Yes. The backend can store the application record and later be replaced with any storage layer you prefer.</p>
                  </article>
                  <article>
                    <h3>What makes this Canada-specific?</h3>
                    <p>Province selection, Canadian income guidance, and lender-style approval logic are tailored for Canada.</p>
                  </article>
                </div>

                <div className="action-row">
                  <button type="button" className="secondary-btn" onClick={() => setStep(4)}>
                    Back to Credit
                  </button>
                  <button type="button" className="primary-btn" onClick={() => setStep(2)}>
                    Review from Start
                  </button>
                </div>
              </div>
            )}
          </section>

          <aside className="side-card">
            <div className="side-section">
              <span>Data quality</span>
              <p>Each step enforces required fields so the intake produces complete, advisor-ready records.</p>
            </div>

            {/* Current values removed to keep the UI client-facing clean */}

            <div className="side-section">
              <span>Data export & compliance</span>
              <p>
                Records are structured for downstream export (CSV/JSON) and include notes for PII handling — configure your storage and retention policies before using in production.
              </p>
            </div>
          </aside>
        </main>
      </div>

      {showResultModal && result && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="result-modal-title">
          <div className="modal-card">
            <div className="modal-head">
              <div>
                <span className="modal-kicker">Approval result</span>
                <h3 id="result-modal-title">Training-ready proposal record</h3>
              </div>
              <div className="modal-actions-inline">
                <button type="button" className="secondary-btn modal-save-btn" onClick={saveResultToDevice}>
                  Save to device
                </button>
                <button type="button" className="modal-close" onClick={closeResultModal} aria-label="Close result window">
                  ×
                </button>
              </div>
            </div>

            <div className="result-card modal-result-card">
              <div>
                <span>Approval Chance</span>
                <strong>{result.approvalEngine?.approvalChance || engineResult.approvalChance}</strong>
              </div>
              <div>
                <span>Estimated Loan</span>
                <strong>{result.approvalEngine?.estimatedLoan || engineResult.estimatedLoan}</strong>
              </div>
              <div>
                <span>Risk</span>
                <strong>{result.approvalEngine?.risk || engineResult.risk}</strong>
              </div>
            </div>

            <div className="json-preview modal-json-preview">
              <h4>Training-ready proposal record</h4>
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}