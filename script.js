(() => {
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const profileImage = document.querySelector('.avatar img');
  profileImage?.addEventListener('error', () => profileImage.remove(), { once: true });

  const config = window.NATHAN_SITE || {};
  const links = config.links || {};

  document.querySelectorAll('[data-link]').forEach((anchor) => {
    const key = anchor.dataset.link;
    const href = links[key];

    // The HTML contains real fallback URLs so the business card remains useful
    // if JavaScript or site-data.js fails. Config can override them centrally.
    if (href) anchor.href = href;

    if (anchor.href && anchor.href !== '#') {
      anchor.target = '_blank';
      anchor.rel = 'me noreferrer noopener';
    } else {
      anchor.addEventListener('click', (event) => event.preventDefault());
      anchor.setAttribute('aria-disabled', 'true');
    }
  });

  const sectionLinks = Array.from(document.querySelectorAll('.section-nav a[href^="#"]'));
  const sections = sectionLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    const setCurrentSection = (id) => {
      sectionLinks.forEach((link) => {
        const isCurrent = link.getAttribute('href') === `#${id}`;
        link.classList.toggle('is-active', isCurrent);
        if (isCurrent) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setCurrentSection(visible.target.id);
      },
      { rootMargin: '-24% 0px -62% 0px', threshold: [0, 0.15, 0.35] },
    );

    sections.forEach((section) => observer.observe(section));
  }


  const parallaxItems = Array.from(document.querySelectorAll('[data-parallax]'));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobileParallax = window.matchMedia(
    '(max-width: 699px), (orientation: landscape) and (max-height: 600px)',
  );
  const mobilePortraitParallax = window.matchMedia(
    '(max-width: 699px) and (orientation: portrait)',
  );

  if (parallaxItems.length && !reduceMotion.matches) {
    let framePending = false;

    const updateParallax = () => {
      framePending = false;
      const viewportCenter = window.innerHeight / 2;
      const mobileDepthMultiplier = mobileParallax.matches ? 1.38 : 1;
      const travelLimit = mobileParallax.matches ? 50 : 34;

      if (mobileParallax.matches && !mobilePortraitParallax.matches) {
        const pageTravelLimit = 40;
        const pageDepth = 0.045;
        const pageOffset = Math.max(
          -pageTravelLimit,
          Math.min(pageTravelLimit, -window.scrollY * pageDepth),
        );
        document.documentElement.style.setProperty(
          '--page-parallax-y',
          `${pageOffset.toFixed(2)}px`,
        );
      } else {
        document.documentElement.style.setProperty('--page-parallax-y', '0px');
      }

      parallaxItems.forEach((item) => {
        const rect = item.getBoundingClientRect();
        if (rect.bottom < -80 || rect.top > window.innerHeight + 80) return;

        if (mobilePortraitParallax.matches && item.classList.contains('banner')) {
          return;
        }

        if (mobileParallax.matches && item.classList.contains('banner')) {
          /*
           * Portrait and landscape use different source compositions.
           * Portrait keeps the slower-moving downward image treatment.
           * Landscape starts lower in the wide source and travels upward
           * through the available top runway as the page scrolls.
           */
          const isPortraitHero = mobilePortraitParallax.matches;
          const heroOffset = isPortraitHero
            ? Math.max(0, Math.min(132, window.scrollY * 0.52))
            : Math.max(-92, Math.min(0, -window.scrollY * 0.40));

          const heroCard = item.closest('.profile-card');
          if (heroCard) {
            heroCard.style.setProperty(
              '--hero-parallax-y',
              `${heroOffset.toFixed(2)}px`,
            );
          }
          item.style.setProperty('--parallax-y', `${heroOffset.toFixed(2)}px`);
          return;
        }

        const strength =
          Number.parseFloat(item.dataset.parallaxStrength || '0.08') * mobileDepthMultiplier;
        const elementCenter = rect.top + rect.height / 2;
        let itemTravelLimit = travelLimit;

        if (mobileParallax.matches) {
          if (item.classList.contains('parallax-water-bokeh')) {
            itemTravelLimit = 130;
          } else if (item.classList.contains('parallax-spiral')) {
            itemTravelLimit = 100;
          } else if (
            mobilePortraitParallax.matches &&
            item.classList.contains('parallax-bokeh-trail')
          ) {
            itemTravelLimit = 90;
          }
        }

        const offset = Math.max(
          -itemTravelLimit,
          Math.min(itemTravelLimit, -(elementCenter - viewportCenter) * strength),
        );
        item.style.setProperty('--parallax-y', `${offset.toFixed(2)}px`);
      });
    };

    const requestParallaxUpdate = () => {
      if (framePending) return;
      framePending = true;
      window.requestAnimationFrame(updateParallax);
    };

    updateParallax();
    window.addEventListener('scroll', requestParallaxUpdate, { passive: true });
    window.addEventListener('resize', requestParallaxUpdate, { passive: true });
  }
})();
