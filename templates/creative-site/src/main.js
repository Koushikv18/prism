import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
gsap.registerPlugin(ScrollTrigger);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Smooth scroll wired into GSAP's ticker
const lenis = new Lenis({ lerp: 0.1 });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add(t => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);

// WebGL hero: fullscreen shader reacting to mouse + scroll
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const u = { uTime: { value: 0 }, uMouse: { value: new THREE.Vector2(.5, .5) }, uScroll: { value: 0 }, uRes: { value: new THREE.Vector2() } };
const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=vec4(position,1.);}',
  fragmentShader: `varying vec2 v;uniform float uTime,uScroll;uniform vec2 uMouse,uRes;
  float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
  void main(){vec2 p=(v-.5)*vec2(uRes.x/uRes.y,1.);float d=length(p-(uMouse-.5)*vec2(uRes.x/uRes.y,1.));
  float f=n(p*3.+uTime*.15+d*2.)+.5*n(p*7.-uTime*.1);f=smoothstep(.35,1.1,f-d*.4+uScroll*.2);
  vec3 c=mix(vec3(.04,.04,.06),vec3(.49,.96,.83),f);gl_FragColor=vec4(c,1.);}` });
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); u.uRes.value.set(innerWidth, innerHeight); };
addEventListener('resize', resize); resize();
addEventListener('pointermove', e => gsap.to(u.uMouse.value, { x: e.clientX / innerWidth, y: 1 - e.clientY / innerHeight, duration: 1, ease: 'power3.out' }));
lenis.on('scroll', ({ scroll, limit }) => u.uScroll.value = scroll / limit);
renderer.setAnimationLoop(t => { u.uTime.value = reduce ? 0 : t / 1000; renderer.render(scene, cam); });
document.addEventListener('visibilitychange', () => renderer.setAnimationLoop(document.hidden ? null : t => { u.uTime.value = t / 1000; renderer.render(scene, cam); }));

// Reveal animations
if (!reduce) {
  gsap.from('h1', { yPercent: 40, opacity: 0, duration: 1.4, ease: 'expo.out' });
  gsap.utils.toArray('.reveal').forEach(el => gsap.from(el, { y: 60, opacity: 0, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 85%' } }));
}
