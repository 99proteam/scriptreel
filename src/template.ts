/** The example script written by `scriptreel init`. */
export const INIT_TEMPLATE = `# scriptreel demo script — docs: https://github.com/99proteam/scriptreel#script-format
# Record it with:  npx scriptreel record demo.yml -o demo.mp4

url: https://playwright.dev
viewport: { width: 1440, height: 900 }

# Optional video settings (command-line flags override these)
# size: youtube        # 1920x1080 | reel | square | WIDTHxHEIGHT
# zoom: subtle         # off | subtle | strong
# theme: light         # light | dark window frame
# background: aurora   # aurora | ocean | sunset | mint | midnight | "#0f172a" | "#6366f1, #ec4899"
# blur: [".email"]     # hide private data

steps:
  - caption: "Playwright: reliable end-to-end testing"
    voiceover: "Let's take a quick look at the Playwright website."
  - zoom: "h1"
  - caption: "Find the docs in one click"
  - click: "text=Get started"
  - wait: { selector: "h1" }
  - scroll: { by: 600 }
  - pause: 1000

  # Typing into a form. Keep secrets out of the script with environment variables:
  # - type: { selector: "#email", text: "demo@example.com" }
  # - type: { selector: "#password", text: "\${DEMO_PASSWORD}", hidden: true }
  # - click: "button[type=submit]"
`;
