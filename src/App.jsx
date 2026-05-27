import { jsPDF } from 'jspdf'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const intakeFields = [
  { key: 'name', label: 'What is your full name?', placeholder: 'Enter your name' },
  { key: 'age', label: 'What is your age?', type: 'number', placeholder: '18 - 65' },
  {
    key: 'maritalStatus',
    label: 'What is your marital status?',
    options: ['Single', 'Married', 'Divorced', 'Common Law', 'Widowed'],
  },
  { key: 'dependents', label: 'How many dependents do you have?', type: 'number', placeholder: '0' },
  {
    key: 'province',
    label: 'Which province do you live in?',
    options: [
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
    ],
  },
  {
    key: 'employmentType',
    label: 'What type of employment do you have?',
    options: ['Salaried', 'Self-employed', 'Business owner', 'Entrepreneur', 'Freelancer', 'Unemployed'],
  },
  { key: 'monthlyIncome', label: 'What is your monthly income in CAD?', type: 'number', placeholder: '8500' },
  { key: 'savings', label: 'How much savings do you have in CAD?', type: 'number', placeholder: '40000' },
  { key: 'existingLoans', label: 'How much do you pay in existing loans each month?', type: 'number', placeholder: '1200' },
  { key: 'monthlyExpenses', label: 'What are your monthly expenses in CAD?', type: 'number', placeholder: '3000' },
  { key: 'yearsOfExperience', label: 'How many years of work experience do you have?', type: 'number', placeholder: '5' },
  { key: 'creditStrength', label: 'What is your credit strength score? Use the 300 to 900 range.', type: 'number', placeholder: '778' },
  { key: 'desiredLoanAmount', label: 'What loan amount do you want in CAD?', type: 'number', placeholder: '500000' },
  { key: 'propertyBudget', label: 'What is your property budget in CAD?', type: 'number', placeholder: '650000' },
  { key: 'downPayment', label: 'What is your down payment in CAD?', type: 'number', placeholder: '65000' },
]

const faqItems = [
  {
    question: 'Why is this built as a chat flow?',
    answer: 'The assistant collects the same mortgage fields step by step so the experience feels closer to ChatGPT or Claude.',
  },
  {
    question: 'How is approval chance calculated?',
    answer: 'The app combines the captured answers with a deterministic scoring engine and any example records from the API.',
  },
  {
    question: 'Can I edit an answer after typing it?',
    answer: 'Yes. After the intake is complete, you can send a message like “change income to 9000” or “update province to Ontario”.',
  },
]

const initialForm = {
  name: '',
  age: '',
  maritalStatus: '',
  dependents: '',
  province: '',
  employmentType: '',
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
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function numberOrZero(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeCreditStrength(value) {
  const score = numberOrZero(value)
  if (score <= 0) return 0
  if (score <= 100) return Math.round(300 + (score / 100) * 600)
  if (score >= 300 && score <= 900) return Math.round(score)
  return Math.max(300, Math.min(900, Math.round(score)))
}

function isValidCreditStrength(value) {
  const score = numberOrZero(value)
  return score >= 300 && score <= 900
}

function sameFieldValue(left, right) {
  return String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase()
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

function exampleDistance(form, example) {
  const weights = {
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
  Object.entries(weights).forEach(([key, weight]) => {
    const leftValue = key === 'creditStrength' ? normalizeCreditStrength(form[key]) : numberOrZero(form[key])
    const rightValue = key === 'creditStrength' ? normalizeCreditStrength(example[key]) : numberOrZero(example[key])
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

function validateField(key, value) {
  const numericValue = numberOrZero(value)

  switch (key) {
    case 'name':
      return String(value || '').trim() ? '' : 'Name is required.'
    case 'age':
      return numericValue >= 18 && numericValue <= 65 ? '' : 'Age must be between 18 and 65.'
    case 'maritalStatus':
    case 'province':
    case 'employmentType':
      return String(value || '').trim() ? '' : 'This field is required.'
    case 'dependents':
    case 'monthlyIncome':
    case 'savings':
    case 'existingLoans':
    case 'monthlyExpenses':
    case 'yearsOfExperience':
    case 'desiredLoanAmount':
    case 'propertyBudget':
    case 'downPayment':
      return numericValue >= 0 ? '' : 'Enter a valid number.'
    case 'creditStrength':
      return isValidCreditStrength(value) ? '' : 'Credit strength must be between 300 and 900.'
    default:
      return ''
  }
}

function validateStep(stepIndex, form) {
  const errors = {}
  intakeFields.slice(0, stepIndex + 1).forEach((field) => {
    const error = validateField(field.key, form[field.key])
    if (error) errors[field.key] = error
  })
  return errors
}

function approvalEngine(form) {
  const income = numberOrZero(form.monthlyIncome)
  const creditStrength = normalizeCreditStrength(form.creditStrength)
  const debt = numberOrZero(form.existingLoans)
  const expenses = numberOrZero(form.monthlyExpenses)
  const savings = numberOrZero(form.savings)
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

function buildResultTitle(result) {
  if (result.risk === 'Low') return 'Strong approval position'
  if (result.risk === 'Medium') return 'Moderate approval position'
  return 'Higher review risk'
}

function fieldLabel(field) {
  return field.label.replace(/^What is /i, 'Tell me ')
}

function getResponseHint(field) {
  if (!field) return 'Type your answer here.'
  if (field.key === 'age') return 'Age must be between 18 and 65.'
  if (field.options) return 'Pick an option or type your own answer.'
  if (field.type === 'number') return 'Type a number and press Enter.'
  return 'Answer in a short sentence.'
}

function getQuickSuggestions(field) {
  if (!field) return ['Generate result', 'Show approval chance', 'Change income to 9000']
  if (field.key === 'age') return ['18', '35', '65']
  if (field.key === 'maritalStatus') return ['Single', 'Married', 'Divorced']
  if (field.key === 'province') return ['Ontario', 'Alberta', 'British Columbia']
  if (field.key === 'employmentType') return ['Salaried', 'Self-employed', 'Business owner']
  if (field.type === 'number') {
    if (field.key === 'monthlyIncome') return ['5500', '7500', '10000']
    if (field.key === 'savings') return ['25000', '50000', '100000']
    if (field.key === 'creditStrength') return ['650', '720', '780']
    if (field.key === 'dependents') return ['0', '1', '2']
  }
  return ['Yes', 'No', 'Not sure']
}

function parseEditableFieldUpdate(message) {
  const match = message.match(/(?:change|update|edit|set)\s+(.+?)\s+to\s+(.+)/i)
  if (!match) return null

  const target = match[1].trim().toLowerCase()
  const rawValue = match[2].trim()

  const map = {
    name: 'name',
    age: 'age',
    income: 'monthlyIncome',
    'monthly income': 'monthlyIncome',
    savings: 'savings',
    loans: 'existingLoans',
    'existing loans': 'existingLoans',
    expenses: 'monthlyExpenses',
    'monthly expenses': 'monthlyExpenses',
    experience: 'yearsOfExperience',
    'years of experience': 'yearsOfExperience',
    'credit strength': 'creditStrength',
    credit: 'creditStrength',
    'loan amount': 'desiredLoanAmount',
    'desired loan amount': 'desiredLoanAmount',
    budget: 'propertyBudget',
    'property budget': 'propertyBudget',
    'down payment': 'downPayment',
    province: 'province',
    employment: 'employmentType',
    'employment type': 'employmentType',
    status: 'maritalStatus',
    'marital status': 'maritalStatus',
    dependents: 'dependents',
  }

  return map[target] ? { key: map[target], value: rawValue } : null
}

export default function App() {
  const [form, setForm] = useState(initialForm)
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'I’ll collect your mortgage readiness details one question at a time. Answer each prompt and I’ll calculate the result when we finish.',
    },
  ])
  const [draft, setDraft] = useState('')
  const [activeFieldIndex, setActiveFieldIndex] = useState(0)
  const [isTyping, setIsTyping] = useState(false)
  const [trainingExamples, setTrainingExamples] = useState([])
  const [savedState, setSavedState] = useState('idle')
  const [resultRequested, setResultRequested] = useState(false)
  const [sidebarView, setSidebarView] = useState('overview')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [selectedAnswers, setSelectedAnswers] = useState({})
  const chatScrollRef = useRef(null)
  const typingTimerRef = useRef(null)

  const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000'
  const exampleResult = useMemo(() => lookupExampleResult(form, trainingExamples), [form, trainingExamples])
  const approvalResult = useMemo(() => exampleResult || approvalEngine(form), [exampleResult, form])
  const intakeComplete = activeFieldIndex >= intakeFields.length
  const currentField = intakeFields[activeFieldIndex]
  const currentErrors = useMemo(() => validateStep(activeFieldIndex, form), [activeFieldIndex, form])
  const hasConversationStarted = messages.some((message) => message.role === 'user')
  const latestAssistantMessage = useMemo(() => {
    return [...messages].reverse().find((m) => m.role === 'assistant')
  }, [messages])
  const sidebarHighlights = [
    { x: '10%', y: '18%' },
    { x: '42%', y: '36%' },
    { x: '74%', y: '22%' },
    { x: '22%', y: '66%' },
    { x: '64%', y: '58%' },
    { x: '50%', y: '82%' },
  ]
  const sidebarNav = [
    { id: 'overview', label: 'Overview' },
    { id: 'faq', label: 'FAQs' },
    { id: 'read-doc', label: 'Read Document' },
  ]
  const chatProgress = Math.max(0, messages.length - 1)
  const heroScale = Math.max(0.74, Math.min(1.12, 1.12 - chatProgress * 0.022))

  useEffect(() => {
    const controller = new AbortController()

    fetch(`${apiBaseUrl}/api/approval-examples`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load training examples.')
        return response.json()
      })
      .then((data) => {
        if (Array.isArray(data.examples)) setTrainingExamples(data.examples)
      })
      .catch(() => setTrainingExamples([]))

    return () => controller.abort()
  }, [apiBaseUrl])

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [messages, isTyping, approvalResult, intakeComplete])

  useEffect(() => {
    if (hasConversationStarted) setMobileMenuOpen(false)
  }, [hasConversationStarted])

  // If the conversation hasn't started yet, push the first intake question
  useEffect(() => {
    if (!hasConversationStarted && !isTyping && !intakeComplete && messages.length <= 1) {
      // queue the first question so the chat shows the prompt
      queueAssistantReply(fieldLabel(currentField), 420)
    }
  }, [hasConversationStarted, isTyping, intakeComplete, messages.length, currentField])

  useEffect(() => () => {
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current)
  }, [])

  const pushMessage = (role, text) => {
    setMessages((current) => [
      ...current,
      {
        id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role,
        text,
      },
    ])
  }

  const queueAssistantReply = (text, delay = 260, afterReply) => {
    setIsTyping(true)
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current)
    typingTimerRef.current = window.setTimeout(() => {
      setIsTyping(false)
      pushMessage('assistant', text)
      if (afterReply) afterReply()
    }, delay)
  }

  const setFieldValue = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setSelectedAnswers((current) => ({ ...current, [key]: value }))
    setSavedState('idle')
  }

  const askNextQuestion = (nextIndex) => {
    const nextField = intakeFields[nextIndex]
    if (!nextField) return
    queueAssistantReply(fieldLabel(nextField), 320, () => {
      setActiveFieldIndex(nextIndex)
    })
  }

  const summarizeResult = () => `Your mortgage result is ready. Approval chance is ${approvalResult.approvalChance}, estimated loan is ${approvalResult.estimatedLoan}, and risk is ${approvalResult.risk}.`

  const isResultRequest = (message) => /\b(generate|show|create|build|make|download)\b.*\b(result|report|pdf|script)\b|\bresult\s+script\b|\bshow\s+me\s+the\s+result\b/i.test(message)

  const isFieldUpdateRequest = (message) => /\b(change|update|edit|set)\b|\bmarried\b|\bsingle\b|\bdivorced\b|\bcommon law\b|\bwidowed\b|\bincome\b|\bsavings\b|\bcredit\b|\bage\b|\bprovince\b|\bemployment\b|\bloan\b|\bbudget\b|\bdown payment\b/i.test(message)

  const parseFollowUpUpdates = (message) => {
    const updates = []
    const lowerMessage = message.toLowerCase()

    const pushUpdate = (key, value) => {
      if (!value) return
      if (updates.some((item) => item.key === key)) return
      updates.push({ key, value })
    }

    if (/\bcommon law\b/.test(lowerMessage)) pushUpdate('maritalStatus', 'Common Law')
    else if (/\bwidowed\b/.test(lowerMessage)) pushUpdate('maritalStatus', 'Widowed')
    else if (/\bdivorced\b/.test(lowerMessage)) pushUpdate('maritalStatus', 'Divorced')
    else if (/\bmarried\b/.test(lowerMessage)) pushUpdate('maritalStatus', 'Married')
    else if (/\bsingle\b/.test(lowerMessage)) pushUpdate('maritalStatus', 'Single')

    const optionFields = [
      ['province', intakeFields.find((field) => field.key === 'province')?.options || []],
      ['employmentType', intakeFields.find((field) => field.key === 'employmentType')?.options || []],
    ]

    optionFields.forEach(([key, options]) => {
      for (const option of options) {
        if (new RegExp(`\\b${option.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lowerMessage)) {
          pushUpdate(key, option)
          break
        }
      }
    })

    const numberFieldPatterns = [
      ['age', /\bage(?:\s+is|\s*=|\s+to|\s+at|\s*:)\s*([0-9][0-9,]*)/i],
      ['dependents', /\bdependents?(?:\s+is|\s*=|\s+to|\s*:)\s*([0-9][0-9,]*)/i],
      ['monthlyIncome', /\bincome(?:\s+is|\s*=|\s+to|\s+now|\s*:)\s*([$0-9,]+(?:\.[0-9]+)?)?/i],
      ['savings', /\bsavings?(?:\s+is|\s*=|\s+to|\s*:)\s*([$0-9,]+(?:\.[0-9]+)?)?/i],
      ['existingLoans', /\bloans?(?:\s+is|\s*=|\s+to|\s*:)\s*([$0-9,]+(?:\.[0-9]+)?)?/i],
      ['monthlyExpenses', /\bexpenses?(?:\s+is|\s*=|\s+to|\s*:)\s*([$0-9,]+(?:\.[0-9]+)?)?/i],
      ['yearsOfExperience', /\bexperience(?:\s+is|\s*=|\s+to|\s*:)\s*([0-9][0-9,]*)/i],
      ['creditStrength', /\bcredit(?:\s+strength|\s+score)?(?:\s+is|\s*=|\s+to|\s*:)\s*([0-9][0-9,]*)/i],
      ['desiredLoanAmount', /\bloan(?:\s+amount)?(?:\s+is|\s*=|\s+to|\s*:)\s*([$0-9,]+(?:\.[0-9]+)?)?/i],
      ['propertyBudget', /\bbudget(?:\s+is|\s*=|\s+to|\s*:)\s*([$0-9,]+(?:\.[0-9]+)?)?/i],
      ['downPayment', /\bdown payment(?:\s+is|\s*=|\s+to|\s*:)\s*([$0-9,]+(?:\.[0-9]+)?)?/i],
    ]

    numberFieldPatterns.forEach(([key, pattern]) => {
      const match = message.match(pattern)
      if (match?.[1]) {
        pushUpdate(key, match[1].replace(/[$,]/g, '').trim())
      }
    })

    const fallback = parseEditableFieldUpdate(message)
    if (fallback && updates.length === 0) pushUpdate(fallback.key, fallback.value)

    return updates
  }

  const acknowledgeResult = (includePdf = false) => {
    const resultText = summarizeResult()
    pushMessage('assistant', resultText)
    if (includePdf) {
      saveResultToDevice()
    }
  }

  const handleFieldAnswer = (rawValue) => {
    const field = currentField
    if (!field) return

    const cleaned = String(rawValue ?? '').trim()
    if (!cleaned) return

    const error = validateField(field.key, cleaned)
    if (error) {
      pushMessage('assistant', error)
      return
    }

    pushMessage('user', cleaned)
    setFieldValue(field.key, cleaned)

    const nextIndex = activeFieldIndex + 1
    if (nextIndex < intakeFields.length) {
      askNextQuestion(nextIndex)
    } else {
      setActiveFieldIndex(nextIndex)
      queueAssistantReply('All 15 questions are complete. You can ask follow-up questions, change any field, or type “generate result” whenever you want.', 420)
    }
  }

  const handleChatText = (rawText) => {
    if (isTyping) return

    const nextInput = String(rawText || '').trim()
    setDraft('')
    if (!nextInput) return

    if (!intakeComplete) {
      handleFieldAnswer(nextInput)
      return
    }

    pushMessage('user', nextInput)

    if (isResultRequest(nextInput)) {
      setResultRequested(true)
      const wantsPdf = /\b(pdf|download|script)\b/i.test(nextInput)
      acknowledgeResult(wantsPdf)
      return
    }

    const updates = parseFollowUpUpdates(nextInput)
    if (updates.length > 0) {
      updates.forEach((update) => setFieldValue(update.key, update.value))
      const summary = updates
        .map((update) => `${update.key.replace(/([A-Z])/g, ' $1').toLowerCase()} is now ${update.value}`)
        .join(', ')
      pushMessage('assistant', resultRequested ? `Updated ${summary}. ${summarizeResult()}` : `Updated ${summary}. Ask me to generate the result when you are ready.`)
      return
    }

    const normalized = nextInput.toLowerCase()
    if (/approval|chance|percent/.test(normalized)) {
      pushMessage('assistant', `Based on the current answers, your estimated approval chance is ${approvalResult.approvalChance}.`)
      return
    }
    if (/loan|eligible|borrow/.test(normalized)) {
      pushMessage('assistant', `Your estimated loan amount is ${approvalResult.estimatedLoan}. The current risk level is ${approvalResult.risk}.`)
      return
    }
    if (/risk|score/.test(normalized)) {
      pushMessage('assistant', `The mortgage profile is currently marked as ${approvalResult.risk} risk. Credit strength and income stability are the biggest drivers.`)
      return
    }

    pushMessage('assistant', intakeComplete ? 'Ask me to generate the result, download the PDF, or change any previous answer.' : 'I can explain your mortgage result, estimate eligibility, or update any captured field.')
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit(event)
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    handleChatText(draft)
  }

  const handleOptionClick = (option) => {
    if (isTyping) return
    handleFieldAnswer(option)
  }

  const handleSuggestionClick = (value) => {
    if (isTyping) return
    handleChatText(value)
  }

  const saveResultToDevice = () => {
    const record = {
      approvalEngine: approvalResult,
      personalInfo: {
        name: form.name,
        age: form.age,
        maritalStatus: form.maritalStatus,
        dependents: form.dependents,
        province: form.province,
      },
      incomeStructure: {
        employmentType: form.employmentType,
        monthlyIncome: form.monthlyIncome,
        savings: form.savings,
        existingLoans: form.existingLoans,
        monthlyExpenses: form.monthlyExpenses,
        yearsOfExperience: form.yearsOfExperience,
      },
      creditEligibility: {
        creditStrength: form.creditStrength,
        desiredLoanAmount: form.desiredLoanAmount,
        propertyBudget: form.propertyBudget,
        downPayment: form.downPayment,
      },
      savedAt: new Date().toISOString(),
      exampleMatched: Boolean(exampleResult),
    }

    const fileName = `${(form.name || 'mortgage-readiness').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'mortgage-readiness'}-result.pdf`
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const marginX = 14
    let cursorY = 18
    const pageWidth = pdf.internal.pageSize.getWidth()
    const contentWidth = pageWidth - marginX * 2

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(18)
    pdf.text('Mortgage readiness result', marginX, cursorY)
    cursorY += 10

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(11)
    pdf.text(`Approval chance: ${approvalResult.approvalChance}`, marginX, cursorY)
    cursorY += 6
    pdf.text(`Estimated loan: ${approvalResult.estimatedLoan}`, marginX, cursorY)
    cursorY += 6
    pdf.text(`Risk: ${approvalResult.risk}`, marginX, cursorY)
    cursorY += 10

    const lines = pdf.splitTextToSize(JSON.stringify(record, null, 2), contentWidth)
    pdf.text(lines, marginX, cursorY)
    pdf.save(fileName)
    setSavedState('saved')
  }

  return (
    <div className="app-shell">
      <div className="app-backdrop" />

      <div className="app-frame">
        <header className="topbar">
          <button type="button" className="icon-only mobile-menu-toggle" aria-label="Open menu" onClick={() => setMobileMenuOpen((current) => !current)}>
            ☰
          </button>
        </header>

        <div className={`drawer-backdrop ${mobileMenuOpen ? 'open' : ''}`} onClick={() => setMobileMenuOpen(false)} />

        <aside className={`sidebar-panel ${mobileMenuOpen ? 'open' : ''}`}>
          <div className="sidebar-inner">
            <div className="sidebar-brand-row">
              <div className="sidebar-brand-badge" aria-hidden="true">
                <span />
              </div>
              <div className="sidebar-brand-copy">
                <strong>Mortgage Assistant</strong>
                <span>Track readiness by chatting naturally.</span>
              </div>
              <button type="button" className="icon-only mobile-close sidebar-close" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)}>✕</button>
            </div>

            <div className="hero-copy-card hero-copy-overview">
              <div className="section-head-row">
                <span className="eyebrow">Overview</span>
                <span className="section-side-text">Quick guide</span>
              </div>
              {sidebarView === 'overview' && (
                <>
                  <h2>Simple, guided, mortgage-first chat.</h2>
                  <p>Only the overview and FAQ content stays in the side rail. The rest of the screen is reserved for the live chat and result flow.</p>
                </>
              )}
              {sidebarView === 'read-doc' && (
                <>
                  <h2>Read Document</h2>
                  <p>Use the chat to answer step by step, then ask the assistant to generate or download the result whenever you are ready.</p>
                </>
              )}
            </div>

            <div className="hero-copy-card hero-copy-faq">
              <div className="section-head-row">
                <span className="eyebrow">FAQs</span>
                <span className="section-side-text">3 common questions</span>
              </div>
              <div className="hero-faq-stack">
                {faqItems.slice(0, 3).map((item) => (
                  <button key={item.question} type="button" className="hero-faq-btn">
                    <span>{item.question}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <main className="app-stage">
          <div className="stage-main-content">
            {/* Hero Section Transition Wrapper */}
            <div className={`hero-transition-wrap ${hasConversationStarted ? 'collapsed' : 'expanded'}`}>
              <section className="hero-preview-card hero-stage-card">
                <div className="hero-preview-top">
                  <div className="hero-preview-dot" aria-hidden="true" />
                  <span>Mortgage Assistant</span>
                  <div className="hero-preview-square" aria-hidden="true" />
                </div>

                <div className="hero-center-content">
                  <div className="hero-mini-card">
                    <div className="hero-icon" aria-hidden="true">
                      <svg width="32" height="32" viewBox="0 0 34 34" fill="none">
                        <path d="M17 8L19.5 14L26 14L21 18L23 24.5L17 21L11 24.5L13 18L8 14L14.5 14Z" stroke="#ff5a00" strokeWidth="1.4" strokeLinejoin="round" fill="none" />
                        <circle cx="17" cy="17" r="3" fill="#ff5a00" opacity="0.85" />
                        <line x1="17" y1="4" x2="17" y2="7" stroke="#ff6a20" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="17" y1="27" x2="17" y2="30" stroke="#ff6a20" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="4" y1="17" x2="7" y2="17" stroke="#ff6a20" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="27" y1="17" x2="30" y2="17" stroke="#ff6a20" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </div>
                    <h1>Mortgage Assistant</h1>
                    <p>Track mortgage readiness by typing naturally.</p>
                  </div>

                  <div className="hero-network-actions" role="tablist" aria-label="Hero sections">
                    {sidebarNav.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`hero-network-action ${sidebarView === item.id ? 'active' : ''}`}
                        onClick={() => setSidebarView(item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div className="hero-network">
                    <div className="hero-network-dots" aria-hidden="true">
                      {sidebarHighlights.map((item, index) => (
                        <span key={`${item.x}-${item.y}-${index}`} className="hero-network-node" style={{ left: item.x, top: item.y }} />
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* Chat Section Transition Wrapper */}
            <div className={`chat-transition-wrap ${hasConversationStarted ? 'expanded' : 'collapsed'}`}>
              <div className="chat-stream" ref={chatScrollRef}>
                {messages.map((message) => (
                  <article key={message.id} className={`chat-bubble ${message.role}`}>
                    <p>{message.text}</p>
                  </article>
                ))}

                {isTyping && (
                  <article className="chat-bubble assistant typing">
                    <div className="typing-dots" aria-label="Assistant is typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  </article>
                )}

                {intakeComplete && resultRequested && (
                  <section className="result-panel">
                    <div className="result-head">
                      <span className="eyebrow">Result</span>
                      <h3>{buildResultTitle(approvalResult)}</h3>
                    </div>
                    <div className="result-grid">
                      <div>
                        <span>Approval chance</span>
                        <strong>{approvalResult.approvalChance}</strong>
                      </div>
                      <div>
                        <span>Estimated loan</span>
                        <strong>{approvalResult.estimatedLoan}</strong>
                      </div>
                      <div>
                        <span>Risk</span>
                        <strong>{approvalResult.risk}</strong>
                      </div>
                    </div>
                    <div className="result-meta">
                      <p>Any follow-up edit updates this result instantly. Ask to regenerate the PDF when you are ready.</p>
                      <button type="button" className="result-action" onClick={() => saveResultToDevice()}>
                        Generate PDF
                      </button>
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Area Pinned */}
          <div className="bottom-area">
            {hasConversationStarted && getQuickSuggestions(currentField).length > 0 && (
              <div className="suggestions">
                {getQuickSuggestions(currentField).map((item) => (
                  <button key={item} type="button" className="chip" onClick={() => handleSuggestionClick(item)}>
                    {item}
                  </button>
                ))}
              </div>
            )}

            {!hasConversationStarted && latestAssistantMessage && (
              <div key={latestAssistantMessage.id} className="ai-prompt-line">
                {latestAssistantMessage.text}
              </div>
            )}

            <form className="input-bar" onSubmit={handleSubmit}>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={currentField ? currentField.placeholder || currentField.label : 'Type a follow-up question...'}
                rows={1}
              />
              <button type="submit" className="send-btn" aria-label="Send message">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </form>

            {savedState === 'saved' && <div className="status-pill success">Saved to device</div>}
          </div>
        </main>
      </div>
    </div>
  )
}