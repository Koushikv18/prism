# Skill: creative-web (award-style immersive sites)
Goal: build original sites in the style of top creative studios (e.g. lusion.co): WebGL hero, buttery scroll, cinematic motion. Study references with `inspect_site` to learn their stack and structure, then write ORIGINAL code, copy, and assets. Never copy proprietary code, 3D models, images, fonts, or text from a reference site.

Stack: Vite + vanilla JS or React Three Fiber, three.js, GSAP + ScrollTrigger, Lenis smooth scroll, custom GLSL shaders, optional Rapier physics, drei helpers.
Workflow:
1. `inspect_site` the reference; note libs, section order, interaction types, typography feel.
2. `scaffold` template `creative-site` into the workspace, then `run_command` npm install.
3. Build in this order: layout + typography, Lenis + ScrollTrigger reveals, WebGL hero (shader/particles/instanced meshes), page transitions, custom cursor, preloader.
Quality bar: 60fps (cap devicePixelRatio at 2, dispose geometries/materials, pause offscreen canvases), responsive down to 360px, prefers-reduced-motion fallback, semantic HTML, alt text, Lighthouse a11y >= 90, lazy-load heavy assets, compress textures (KTX2/WebP) and models (Draco).
Design: pick one bold palette, one display + one text font, big type, generous spacing, motion with easing (power3/expo), no generic gradients.
