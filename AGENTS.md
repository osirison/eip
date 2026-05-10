# AGENTS

EIP stands for Engineering Intelligence Platform.

## Core Rules

1. Always ask clarifying questions until requirements are clear. Do not assume missing requirements.
2. Always use sub-agents to execute work. Before execution, define the task clearly, cover edge cases, and let the execution sub-agent solve the problem autonomously.
3. Always follow this loop: PLAN -> EXECUTE -> VERIFY.
4. After execution, a verifier sub-agent must validate the result. Any feedback must go back to the execution sub-agent until the work is complete.
5. If an agent discovers a better repeatable way to work, it must update workspace memory with the improved practice.

## Quality Bar

1. Prefer secure, maintainable solutions.
2. Add or update tests when behavior changes or new logic is introduced.
3. Update documentation or repo instructions when workflows or behavior change.
4. Keep changes focused, explicit, and production-ready.
