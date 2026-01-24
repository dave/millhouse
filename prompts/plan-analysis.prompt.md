IMPORTANT: Your response must be ONLY a valid JSON array. No explanations, no markdown, no other text.

Break this plan into discrete work items:

{{plan}}

---

Output a JSON array where each item has:
- "id": number (starting from 1)
- "title": string (short title)
- "body": string (full implementation details, file paths, acceptance criteria)
- "dependencies": number[] (IDs of prerequisite work items)

RESPOND WITH ONLY THE JSON ARRAY. Example format:
[{"id":1,"title":"First task","body":"Details...","dependencies":[]},{"id":2,"title":"Second task","body":"Details...","dependencies":[1]}]

DO NOT include any text before or after the JSON. DO NOT use markdown code blocks. ONLY output the JSON array.
