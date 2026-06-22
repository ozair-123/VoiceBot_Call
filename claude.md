# CLAUDE.md

## Project

SynergyTalk AI Queue Agent

An AI-powered call queue assistant that answers inbound calls, handles common customer queries, and transfers callers to human agents when necessary.

This system integrates with:

* Asterisk PBX
* SIP Trunks
* Faster-Whisper
* Claude API
* Piper TTS
* PostgreSQL
* Node.js backend

Target deployment environment:

* Ubuntu Linux
* 4 vCPU Intel Xeon Gold 6430
* 8 GB RAM
* VMware Virtual Machine

---

## Primary Objective

Reduce call queue load by allowing an AI agent to answer customer questions while they wait.

Examples:

* Business hours
* Pricing enquiries
* Account enquiries
* Product information
* Call routing
* FAQ responses

If the AI cannot confidently answer, it must transfer the caller to a human agent.

---

## Performance Requirements

The system must prioritize low latency.

Target response times:

* Voice Activity Detection: <100ms
* Speech Recognition: <1000ms
* Claude Response: <2000ms
* Text To Speech: <500ms
* Total AI Response Time: <3 seconds

Any design that causes callers to wait more than 5 seconds is unacceptable.

---

## Architecture

Call Flow:

Inbound Call
→ Asterisk Queue
→ AI Session Manager
→ Faster-Whisper
→ Claude API
→ Piper TTS
→ Caller

When requested:
→ Transfer back to Asterisk Queue

---

## Technology Stack

### Telephony

* Asterisk 22
* SIP
* PJSIP
* WebRTC where required

### Speech To Text

* Faster-Whisper
* Prefer small or base models
* Streaming transcription preferred

### LLM

* Claude API
* Maintain conversation memory per call session
* Maximum context retention: 10 previous exchanges

### Text To Speech

* Piper TTS
* Fast CPU inference
* English voice by default

### Database

* PostgreSQL

Store:

* Call logs
* Session transcripts
* Call outcomes
* AI confidence scores

---

## AI Behaviour Rules

The AI must sound like a professional call centre agent.

Responses should:

* Be concise
* Be polite
* Be conversational
* Avoid long explanations

Maximum response length:

* 2 sentences
* Under 40 words whenever possible

Bad:

"Thank you for contacting us today. I would be delighted to explain our complete refund process..."

Good:

"I can help with that. Could you provide your order number?"

---

## Escalation Rules

Immediately transfer to a human agent when:

* Caller requests a human
* Caller becomes frustrated
* Confidence score is low
* Question cannot be answered
* Sensitive account information is requested

Transfer phrase:

"Let me connect you with one of our team members."

---

## Development Rules

Always prioritise:

1. Reliability
2. Low latency
3. Call quality
4. Scalability

Avoid:

* Blocking code
* Synchronous API calls where possible
* Large local language models
* Heavy memory usage

Use:

* Async/await
* Streaming APIs
* Modular services
* Structured logging

---

## Services

Create separate services:

/services/stt
/services/tts
/services/llm
/services/call-session
/services/queue-transfer
/services/database

Each service must be independently testable.

---

## Logging

Log:

* Call start
* Call end
* Transcription
* LLM response time
* TTS generation time
* Transfer events
* Errors

Do not log:

* Passwords
* Payment information
* Sensitive customer data

---

## Error Handling

The caller must never hear silence.

If Claude API fails:

"I'm sorry, I'm having trouble processing your request right now."

If TTS fails:

Transfer to human agent.

If confidence is low:

Transfer to human agent.

---

## Future Roadmap

Phase 1

* FAQ Agent

Phase 2

* CRM Integration

Phase 3

* Appointment Booking

Phase 4

* Multi-language Support

Phase 5

* WhatsApp Integration

Phase 6

* Sentiment Analysis

Phase 7

* Voice Biometrics

---

## Current Server Constraints

Server Specifications:

* 4 vCPU
* 8 GB RAM
* Intel Xeon Gold 6430
* Ubuntu Linux

Do NOT recommend:

* Local 7B+ models
* Local 14B+ models
* GPU-dependent solutions

Prefer:

* Claude API
* Faster-Whisper small/base
* Piper TTS
* Streaming architecture

The server must support multiple simultaneous calls while maintaining low latency.
