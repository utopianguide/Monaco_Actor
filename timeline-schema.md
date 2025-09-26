# Monaco Actor Timeline Schema

This document defines the JSON schema for timeline files used by the Monaco Actor player. A timeline file consists of a single JSON object with an `actions` property, which is an array of action objects.

## Top-Level Structure

The root object must contain a single key, `actions`.

```json
{
  "actions": [
    { ... action object ... },
    { ... action object ... }
  ]
}
```

## Action Object

Each action in the `actions` array is an object with a common set of base properties and action-specific properties determined by the `kind` field.

### Base Properties

All action objects must include these properties:

| Property | Type     | Description                                                                 | Required |
|----------|----------|-----------------------------------------------------------------------------|----------|
| `kind`   | `string` | **Discriminator.** Determines the action type and its specific properties.      | Yes      |
| `timeMs` | `number` | Time in milliseconds from the start of the audio when the action should fire. | Yes      |
| `id`     | `string` | Optional unique identifier for debugging and keying.                        | No       |

---

## Action Kinds

Here are the available action `kind` values and their specific properties.

### `create_file`

Creates a new file in the virtual file system. If the file already exists, its content will be overwritten. This action also opens the file in the editor.

**Properties:**

| Property  | Type     | Description                                               | Required |
|-----------|----------|-----------------------------------------------------------|----------|
| `path`    | `string` | Full path of the file to create (e.g., `src/index.js`).   | Yes      |
| `content` | `string` | Optional initial content for the file. Defaults to `''`.  | No       |

**Example:**
```json
{
  "kind": "create_file",
  "timeMs": 500,
  "path": "README.md",
  "content": "# Hello World"
}
```

### `open_file`

Opens an existing file in the editor, making it the active tab.

**Properties:**

| Property | Type     | Description                                | Required |
|----------|----------|--------------------------------------------|----------|
| `path`   | `string` | Path of the file to open.                  | Yes      |

**Example:**
```json
{
  "kind": "open_file",
  "timeMs": 1200,
  "path": "src/App.tsx"
}
```

### `type`

Inserts text into a file at the current cursor position, simulating typing.

**Properties:**

| Property            | Type     | Description                                                                                             | Required |
|---------------------|----------|---------------------------------------------------------------------------------------------------------|----------|
| `path`              | `string` | Path of the target file. The file is opened if not already active.                                      | Yes      |
| `text`              | `string` | The text to insert. Can include newlines (`\n`).                                                        | Yes      |
| `charactersPerSecond`| `number`| If provided, animates typing character-by-character at this speed. If omitted, text is pasted instantly.| No       |
| `delayMs`           | `number` | Deprecated alternative to `charactersPerSecond`. Total time the typing animation should take.             | No       |

**Example (Animated Typing):**
```json
{
  "kind": "type",
  "timeMs": 2500,
  "path": "src/index.js",
  "text": "console.log('Hello, world!');\n",
  "charactersPerSecond": 25
}
```

### `move_cursor`

Moves the editor cursor to a specific line and column in a file.

**Properties:**

| Property | Type     | Description                                              | Required |
|----------|----------|----------------------------------------------------------|----------|
| `path`   | `string` | Path of the target file.                                 | Yes      |
| `line`   | `number` | 1-based line number.                                     | Yes      |
| `column` | `number` | 1-based column number.                                   | Yes      |

**Example:**
```json
{
  "kind": "move_cursor",
  "timeMs": 4000,
  "path": "src/index.js",
  "line": 1,
  "column": 9
}
```

### `highlight_range`

Applies a temporary visual highlight to a range of text in a file.

**Properties:**

| Property     | Type     | Description                                                                                                                              | Required |
|--------------|----------|------------------------------------------------------------------------------------------------------------------------------------------|----------|
| `path`       | `string` | Path of the target file.                                                                                                                 | Yes      |
| `range`      | `object` | An object defining the start and end of the highlight. See below.                                                                        | Yes      |
| `durationMs` | `number` | Optional duration in milliseconds for the highlight to remain visible. If omitted, it persists until the next highlight or a reset event. | No       |
| `color`      | `string` | Optional color name. Supported: `'blue'`, `'green'`, `'yellow'`, `'pink'`, `'red'`, `'cyan'`. Defaults to blue.                           | No       |

**Range Object:**

| Property      | Type     | Description              |
|---------------|----------|--------------------------|
| `startLine`   | `number` | 1-based start line.      |
| `startColumn` | `number` | 1-based start column.    |
| `endLine`     | `number` | 1-based end line.        |
| `endColumn`   | `number` | 1-based end column.      |

**Example:**
```json
{
  "kind": "highlight_range",
  "timeMs": 5500,
  "path": "src/index.js",
  "range": {
    "startLine": 1,
    "startColumn": 1,
    "endLine": 1,
    "endColumn": 13
  },
  "durationMs": 2000,
  "color": "yellow"
}
```

### `terminal_run`

Displays a command in the integrated terminal as if it were executed.

**Properties:**

| Property  | Type     | Description                               | Required |
|-----------|----------|-------------------------------------------|----------|
| `command` | `string` | The command string to display (e.g., `npm install`). | Yes      |

**Example:**
```json
{
  "kind": "terminal_run",
  "timeMs": 8000,
  "command": "node index.js"
}
```

### `terminal_output`

Writes text directly to the integrated terminal.

**Properties:**

| Property  | Type     | Description                                          | Required |
|-----------|----------|------------------------------------------------------|----------|
| `text`    | `string` | The text to write. Can include newlines (`\n`).      | Yes      |

**Example:**
```json
{
  "kind": "terminal_output",
  "timeMs": 8500,
  "text": "Hello, world!\n"
}
```

### `clear_terminal`

Clears all text from the integrated terminal.

**Properties:** (None beyond base properties)

**Example:**
```json
{
  "kind": "clear_terminal",
  "timeMs": 10000
}
```
