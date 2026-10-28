# Skill: frontend-pro (senior frontend engineer standard)
Before choosing libraries, call `tech_radar` and prefer current stable versions; verify with `npm view <pkg> version` and read release notes before major upgrades.
Defaults: TypeScript, Vite or Next.js (App Router) / Astro for content sites, Tailwind CSS v4 + CSS variables as design tokens, semantic HTML, CSS Grid/Flex/container queries, modern CSS (:has, view transitions, scroll-driven animations, oklch colors), native features before libraries.
Motion: GSAP + ScrollTrigger or Motion for UI, Lenis for scroll, three.js / React Three Fiber for 3D, always with prefers-reduced-motion fallbacks.
Structure: feature folders, small typed components, no prop drilling (context/zustand), data fetching with TanStack Query or server components, forms validated with zod.
Design: a token scale (space, type, radius, color), one accent color, fluid type with clamp(), 8px rhythm, visible focus states, dark mode via prefers-color-scheme, real content not lorem ipsum.
Quality gates: eslint + prettier, strict TS, a11y (labels, contrast >= 4.5:1, keyboard paths), tests for logic, then run `optimize_audit` and fix every high-severity item before finishing.
