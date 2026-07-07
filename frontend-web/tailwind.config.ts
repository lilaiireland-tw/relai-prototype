import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "irish-green": "#2D7A4F",
        "irish-green-dark": "#1E5C3A",
        "card-gray": "#F8F9FA",
        "error-bg": "#FFF0F0",
        "text-primary": "#1A1A2E",
        "text-secondary": "#6B7280",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "PingFang TC",
          "Helvetica Neue",
          "Segoe UI",
          "Arial",
          "sans-serif",
        ],
      },
      maxWidth: {
        app: "430px",
      },
    },
  },
  plugins: [],
};
export default config;
