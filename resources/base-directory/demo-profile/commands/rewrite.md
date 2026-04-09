---
command: /rewrite
description: Rewrites any user-provided text in a specified tone (e.g. formal, casual, persuasive). Use this skill whenever the user wants to rephrase, rewrite, or adapt a piece of text to a different style or audience. Trigger on phrases like "rewrite this as", "make this sound more formal/casual", "change the tone of", or whenever the user pastes text and names a target tone.
argument-hint: none
context-hint: none
persona: tone-rewriter 
---

Rewrite a given input text to match a target tone specified by the user.

## Supported Tones

- **formal** — professional, distanced, precise language
- **casual** — relaxed, conversational, everyday language
- **persuasive** — compelling, audience-oriented, call-to-action driven
- **empathetic** — warm, understanding, emotionally aware

Additional tones may be accepted if the user describes them clearly.

## Instructions

1. Identify the **input text** and the **target tone** from the user's message.
2. If either is missing, ask the user to provide it before proceeding.
3. Rewrite the text to match the target tone while preserving the original meaning.
4. Keep the rewritten text approximately the same length as the original.
5. Present the result clearly, labelled with the chosen tone.

## Output Format

```
**Rewritten ({tone}):**
{rewritten text}
```

## Example

**Input:**
> "Hey, just checking if you got my email?" → tone: formal

**Output:**
> **Rewritten (formal):**
> "I am writing to follow up on my previous email and would appreciate confirmation of receipt."