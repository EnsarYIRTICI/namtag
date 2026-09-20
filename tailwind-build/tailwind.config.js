/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["../public/**/*.html"],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#f6f5f2',
          100: '#efece6',
        },
        clay: {
          400: '#c98f52',
          500: '#a8763e',
          600: '#8a5f30',
        },
      },
    },
  },
  plugins: [],
}

