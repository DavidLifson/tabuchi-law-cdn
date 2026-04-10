/* ============================================
   TABUCHI LAW — Scroll Animations & Navbar
   Add to Webflow Custom Code > Footer
   Wrap in <script>...</script> tags when pasting
   ============================================ */

document.addEventListener('DOMContentLoaded', function () {
  // Scroll-triggered fade-in animations
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('tl-vis');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -60px 0px'
  });

  document.querySelectorAll('[data-tl-anim]').forEach(function (el) {
    observer.observe(el);
  });

  // Sticky navbar scroll effect
  var nav = document.querySelector('.tl-navbar');
  if (nav) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 60) {
        nav.classList.add('tl-nav-scrolled');
      } else {
        nav.classList.remove('tl-nav-scrolled');
      }
    }, { passive: true });
  }
});
