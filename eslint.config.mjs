import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", ".next-audit/**", "out/**", "src/lib/contracts/**", "next-env.d.ts"],
  },
  {
    rules: {
      // Logos are small static/remote SVG/PNG files; next/image adds nothing here
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
