"use client";

import { useEffect } from "react";

/**
 * Scroll reveals for static `.reveal` elements. Content renders visible; only after this runs does
 * `html.reveal-ready` switch on the hidden start state, and anything already on screen is marked `.in`
 * first, so nothing flickers and nothing stays invisible if JavaScript never loads.
 */
export function RevealObserver() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const els = [...document.querySelectorAll<HTMLElement>(".reveal:not(.in)")];
    const vh = window.innerHeight;
    for (const el of els) if (el.getBoundingClientRect().top < vh * 0.95) el.classList.add("in");
    document.documentElement.classList.add("reveal-ready");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    els.forEach((el) => !el.classList.contains("in") && io.observe(el));
    return () => {
      io.disconnect();
      document.documentElement.classList.remove("reveal-ready");
    };
  }, []);
  return null;
}
