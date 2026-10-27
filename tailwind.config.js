/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./renderer/**/*.{html,js}"
  ],
  theme: {
    extend: {
      colors: {
        obsidian: '#030712',
        cyberEmerald: '#10b981',
        cyberCyan: '#06b6d4',
        cyberViolet: '#8b5cf6',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'neon-emerald': '0 0 15px rgba(16, 185, 129, 0.35)',
        'neon-cyan': '0 0 15px rgba(6, 182, 212, 0.35)',
      }
    },
  },
  plugins: [],
}
