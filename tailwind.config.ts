import type { Config } from 'tailwindcss';

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: token('ink'),
        panel: token('panel'),
        raised: token('raised'),
        line: token('line'),
        edge: token('edge'),
        divider: token('divider'),
        chip: token('chip'),
        muted: token('muted'),
        soft: token('soft'),
        fg: token('fg'),
        strong: token('strong'),
        accent: token('accent'),
        onaccent: token('onaccent'),
        good: token('good'),
        bad: token('bad'),
        warn: token('warn'),
        dangerline: token('dangerline'),
        dangerbg: token('dangerbg'),
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
