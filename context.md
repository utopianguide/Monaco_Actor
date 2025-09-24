# CodeNarrator Project Context for Gemini

## 1. High-Level Goal

The user is building a project for a hackathon. The core idea is to create an **AI-powered, voice-narrated, cinematic coding demonstration**. The experience should feel like a "ghost in the machine" is taking over the editor, typing code, navigating files, and explaining what it's doing in perfect sync with its actions. (This is a highly flexiable and general plan)

## 2. The "AI Director" Pipeline

The user has already developed the most complex part of the project: an AI pipeline that acts as a "director" for the code demonstration. This pipeline works as follows:

1.  **Input:** A user provides a codebase (e.g., a GitHub repo) and a prompt (e.g., "Explain the authentication flow").
2.  **Processing:** A combination of an LLM, Text-to-Speech (TTS), and Speech-to-Text (SST) for alignment is used.
3.  **Output:** The pipeline generates a set of synchronized assets:
    *   **A narration audio file (`.mp3`):** A high-quality, expressive, human-like voiceover that explains the code.
    *   **A timed actions JSON file:** A list of editor actions, each with a precise `time_ms` timestamp, indicating exactly when that action should occur relative to the start of the audio file.

**Example Action JSON (`timed-actions/demo_timeline.json`):**
```json
{
  "actions": [
    {
      "action": "create_file",
      "time_ms": 23500,
      "path": "index.html"
    },
    {
      "action": "type",
      "time_ms": 25500,
      "delay_ms": 17000,
      "text": "<!DOCTYPE html>..."
    },
    // ... more actions
  ]
}
```

## 3. The Initial Approach: A VS Code Extension

The original plan was to build a VS Code extension to "play" these timed actions. The extension would read the JSON file, start a timer, and execute the VS Code APIs for creating files, typing text, highlighting code, etc., at the scheduled times.

### 3.1. The Critical Flaw: Timing Drift

This approach was implemented and tested, but it failed to maintain perfect synchronization with the audio. The user provided logs showing the problem:

```
[timeline] ? create_file scheduled=23500ms actual=23462ms drift=-38ms
[timeline] ? type scheduled=25500ms actual=25473ms drift=-27ms
[timeline] ? move_cursor scheduled=44200ms actual=44167ms drift=-33ms
```

**We concluded that this approach is fundamentally flawed for two key reasons:**

1.  **The "Two Unsynchronized Clocks" Problem:** The audio plays in an external media player, which has its own clock. The extension runs on a separate clock based on `performance.now()` and `setInterval`. There is no communication between them. The extension is "flying blind," merely *hoping* it stays in sync with the audio player.

2.  **Unpredictable Action Latency:** The real issue is that VS Code API calls are not instantaneous. An action like `type` involves inter-process communication, updating the UI, running syntax highlighters, etc. This takes a variable amount of time (from milliseconds to seconds). While one action is running, the timeline is effectively frozen, but the audio keeps playing. This causes large, unpredictable, and accumulating drift that a simple `start_offset_ms` cannot fix. The illusion of perfect sync is immediately broken.

## 4. The Strategic Pivot: A Simulated Web Application

Based on the insurmountable timing issues in VS Code, we made a strategic decision to **pivot to a web application that simulates the VS Code experience.**

This approach is better for the hackathon because it provides **absolute control over timing and presentation**, leading to a more polished and reliable "wow" factor.

### 4.1. The Technical Solution for the Web App

*   **The Single Source of Truth:** The HTML `<audio>` element's `currentTime` property will be the **one and only clock** for the entire system.
*   **The Self-Correcting Scheduler:** A `requestAnimationFrame` loop will constantly check the `audio.currentTime`. The logic is simple: "Has the audio's current time passed the scheduled `time_ms` of the next action? If yes, execute it." This makes the system resilient to lag; if the browser freezes, the actions will instantly catch up to the correct point in the audio when it unfreezes.
*   **High-Fidelity UI Components:**
    *   **Editor:** Use the **Monaco Editor**—the open-source editor that powers VS Code itself. This provides an authentic look and feel with syntax highlighting, a rich API for text manipulation, and decorations for highlighting.
    *   **Terminal:** Use **Xterm.js** to simulate the terminal output.

## 5. The Winning Pitch for the Hackathon

The pivot from a local extension to a web app also strengthens the project's narrative.

*   **Original Pitch:** "An AI ghost takes over your local VS Code." (A cool, but limited, local-only tool).
*   **New, More Powerful Pitch:** **"We turn any GitHub repository into a perfectly synced, voice-narrated, cinematic coding experience you can share with a single URL."**

This reframes the project from a toy into a **scalable platform for code communication**. It solves bigger problems like:
*   **Frictionless Onboarding:** Send new hires a link to a guided tour of the codebase.
*   **Better Code Reviews:** Explain a complex Pull Request with a narrated walkthrough.
*   **Next-Gen Documentation:** Create interactive, engaging tutorials that are always in sync.

The "magic" is the AI Director pipeline. The web app is the **premium, shareable player** for the content it creates. The focus on polish and cinematic effects (smooth cursor animations, spotlighting code) will deliver a more impressive and memorable demo than a slightly janky, out-of-sync local extension.

## 6. Detailed Feature Concepts for the Web App

To build a compelling product for the hackathon, we can flesh out the following feature sets.

### 6.1. Action Implementation and Cinematic Effects

This details how to map the existing action types to web technologies, focusing on creating a polished, "cinematic" feel.

*   **`create_file` / `navigate_to_file`:**
    *   **Mechanism:** Manage the file tree structure in a simple state object (e.g., a React state).
    *   **Effect:** When a `create_file` action occurs, animate the new file appearing in the sidebar. For `navigate_to_file`, animate the "active" highlight moving from the old file to the new one. This is followed by calling `monaco.editor.setModel()` to switch the content in the editor pane.

*   **`type` / `add_comment`:**
    *   **Mechanism:** For pre-recorded, audio-synced demos, this should be an atomic operation. Use `editor.executeEdits()` to insert the entire text block at once. This guarantees it completes instantly and maintains perfect sync.
    *   **Effect:** For "from scratch" demos without audio, we can simulate realistic typing. Use `requestAnimationFrame` to insert characters one by one with randomized delays, creating a very cool visual effect.

*   **`move_cursor`:**
    *   **Mechanism:** The basic implementation is a single call to `editor.setPosition()`.
    *   **Effect:** For a more fluid, human-like feel, create a small animation function that interpolates the cursor position over ~200-300ms using `requestAnimationFrame`, calling `editor.setPosition()` on each frame.

*   **`highlight`:**
    *   **Mechanism:** This is a core feature of the Monaco Editor, handled by `editor.deltaDecorations()`. This function allows you to apply CSS classes to specific ranges of text.
    *   **Effect:** We can define several CSS classes to create different effects: a standard yellow highlight, a "spotlight" effect (where non-highlighted code is dimmed using `opacity`), or a temporary "pulse" effect to draw attention.

*   **`run_terminal_command`:**
    *   **Mechanism:** Use the Xterm.js API (`terminal.write()`) to print text to the simulated terminal panel.
    *   **Effect:** We will **not** execute real commands. Instead, we'll simulate the output. For a command like `npm install`, we can print a fake, stylized log with progress bars and checkmarks to make it look realistic and visually interesting.

*   **`show_notification`:**
    *   **Mechanism:** Use a library like `react-hot-toast` or build a simple, clean notification component that overlays the editor.
    *   **Effect:** Keep it minimal and professional, matching the VS Code aesthetic.

### 6.2. Content Creation and Input Scenarios

The platform should be versatile, allowing demos to be created and consumed in multiple ways.

*   **The AI Director (The "Magic" Path):** This is the primary, most impressive workflow.
    *   **Input via GitHub URL:** The user provides a public GitHub repository URL and a prompt. A backend service is required to clone the repo, pass the context to the LLM pipeline, generate the assets (JSON, audio), and make them available to the frontend.
    *   **Input via Project Upload:** To handle private or local code, allow the user to upload a `.zip` file of their project.
    *   **From-Scratch Generation:** The ultimate demo. The user gives a prompt like, "Show me how to build a website with React and Vite." The AI generates the *entire* coding session from an empty directory, including creating files, writing code, and explaining the process. The experience starts with a blank editor, and the "ghost" builds everything.
    *   **Chatbot Interface:** Instead of a simple prompt, the user could have a conversation with the "AI Director" to refine the demo. "Okay, explain the auth, but focus more on the JWT strategy and spend less time on the CSS."

*   **Manual Authoring (The "Creator" Path):** This feature turns the project from a demo into a tool.
    *   **Timeline Editor UI:** Provide a view where a user can upload their own narration audio file. The UI would display the audio waveform.
    *   **Manual Action Placement:** The user can listen to the audio and click on the waveform to manually insert actions (`create_file`, `type`, etc.) from a dropdown. They would then fill in the parameters (e.g., the text for a `type` action).
    *   **Benefit:** This empowers developers, educators, and content creators to craft their own perfect, hand-tuned coding tutorials, making the platform immensely more useful and demonstrating strong product vision.
