# Code Review Prompt

Review the selected code for:

## Correctness
- Does the code do what it's supposed to do?
- Are there any edge cases not handled?
- Are there potential bugs or runtime errors?

## Security
- Any SQL injection, XSS, or other vulnerability risks?
- Are secrets properly managed?
- Input validation present where needed?

## Performance
- Any obvious performance issues?
- N+1 queries or unnecessary loops?
- Opportunities for caching?

## Maintainability
- Is the code easy to understand?
- Are there any code smells?
- Would this be easy to modify later?

## Suggestions
Provide specific, actionable suggestions for improvement with code examples where helpful.
