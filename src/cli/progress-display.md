# Progress Display: Terminal Resize Bug

## The Problem

When the terminal window is resized while the compact progress display is active, lines would wrap and create visual garbage. Each resize event would cause previously rendered lines to wrap to multiple screen lines, and the cursor repositioning logic couldn't properly clear them.

### Symptoms

- Lines appearing multiple times with different truncation lengths
- Text wrapping to the next line creating "stacked" output
- Visual artifacts remaining on screen after resize

### Root Cause

1. **ANSI codes complicate width calculation**: Lines contain ANSI escape codes for colors (e.g., `\x1B[34m` for blue). Simple `.length` on these strings gives wrong results because ANSI codes take bytes but no display width.

2. **Special characters have variable width**: Characters like `●` (bullet) and `│` (box drawing) may be 1 or 2 cells wide depending on the terminal and font.

3. **Wrapped lines persist**: When a terminal shrinks, previously rendered lines wrap to multiple screen lines. When we try to clear N "logical" lines, we only clear N screen lines, leaving wrapped portions visible.

## The Solution

### 1. Use `string-width` for All Measurements

```typescript
import stringWidth from 'string-width';

// Measure actual display width (handles ANSI codes and wide chars)
const iconWidth = stringWidth(stateIcon);  // ● might be 2 cells
const sepWidth = stringWidth(separator);   // │ might be 2 cells
```

### 2. Truncate Plain Text BEFORE Applying Colors

```typescript
// Truncate the plain text first
let title = issue.title;
if (title.length > titleMaxWidth) {
  title = title.slice(0, titleMaxWidth - 3) + '...';
}

// Then apply colors to already-truncated text
const line = `${stateIcon} ${stateColor(numStr)} ${chalk.gray(title)} ...`;
```

### 3. Final Safety Check with Hard Truncate

Even with careful calculation, edge cases can cause lines to be too long. Always verify and hard-truncate if needed:

```typescript
if (stringWidth(line) > maxWidth) {
  return this.hardTruncate(line, maxWidth);
}
```

### 4. Hard Truncate Handles ANSI Codes

The `hardTruncate` function walks the string character by character, skipping ANSI escape sequences (which have zero display width) and tracking actual width:

```typescript
private hardTruncate(str: string, maxWidth: number): string {
  let result = '';
  let width = 0;
  let i = 0;

  while (i < str.length && width < maxWidth - 3) {
    if (str[i] === '\x1B') {
      // ANSI escape - find end and include it (zero width)
      let j = i + 1;
      while (j < str.length && str[j] !== 'm') j++;
      result += str.slice(i, j + 1);
      i = j + 1;
    } else {
      const cw = stringWidth(str[i]);
      if (width + cw > maxWidth - 3) break;
      result += str[i];
      width += cw;
      i++;
    }
  }

  return result + '...\x1B[0m';  // Reset ANSI at end
}
```

### 5. Clear to End of Line After Each Line

Use `\x1B[K` after each line to clear any old wrapped content:

```typescript
output += '\r' + line + '\x1B[K\n';
```

### 6. Clear Below After All Lines

Use `\x1B[J` to clear everything below the last line (handles case where we now have fewer lines):

```typescript
output += '\x1B[J';
```

## Key Takeaways

1. **Never trust `.length` for display width** - always use `string-width`
2. **Truncate plain text before adding colors** - much simpler than truncating colored text
3. **Always verify final width** - edge cases will surprise you
4. **Use terminal escape codes for cleanup** - `\x1B[K` (clear to EOL) and `\x1B[J` (clear below)
5. **Leave a small margin** - use `termWidth - 2` to be safe

## Testing

To test resize handling:
1. Run `millhouse run` with some work items
2. Rapidly resize the terminal window narrower and wider
3. Lines should always stay on single lines, re-truncating as needed
4. No visual artifacts should remain
