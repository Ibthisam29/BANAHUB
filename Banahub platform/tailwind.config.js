/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.html"],
  theme: {
    extend: {
      colors: {
        primary:                    '#003527',
        'primary-container':        '#064e3b',
        'on-primary':               '#ffffff',
        background:                 '#faf9f5',
        surface:                    '#faf9f5',
        'surface-container-lowest': '#ffffff',
        'surface-container-low':    '#f4f4f0',
        'surface-container':        '#efeeea',
        'surface-container-high':   '#e9e8e4',
        'on-surface':               '#1b1c1a',
        'on-surface-variant':       '#404944',
        outline:                    '#707974',
        'outline-variant':          '#bfc9c3',
        secondary:                  '#735c00',
        'secondary-container':      '#fed65b',
        tertiary:                   '#262e42',
        error:                      '#ba1a1a',
      },
      fontFamily: {
        display: ['Newsreader', 'Georgia', 'serif'],
        sans:    ['Manrope', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
