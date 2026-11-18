import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0D1117',
        panel: '#11161D',
        raised: '#161B22',
        line: '#232A34',
        edge: '#2D3541',
        muted: '#A9B4C2',
        soft: '#C9D1D9',
        accent: '#F5C542',
        good: '#6EE7A8',
        bad: '#FF9A9A',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
