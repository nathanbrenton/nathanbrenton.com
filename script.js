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

      if (mobileParallax.matches) {
        /*
         * The page-water layer uses stable viewport geometry in CSS.
         * Portrait gets a slightly gentler depth than landscape.
         */
        const pageTravelLimit = 40;

        /*
         * Portrait page water travels continuously across the full document
         * instead of reaching a pixel clamp early. Landscape keeps its
         * existing depth-based behavior.
         */
        let pageOffset;

        if (mobilePortraitParallax.matches) {
          const maxScroll = Math.max(
            1,
            document.documentElement.scrollHeight - window.innerHeight,
          );
          const scrollProgress = Math.max(
            0,
            Math.min(1, window.scrollY / maxScroll),
          );

          const portraitPageTravelLimit = 48;
          pageOffset = -portraitPageTravelLimit * scrollProgress;
        } else {
          /*
           * Landscape page water also travels across the full document
           * instead of reaching its old +/-40px clamp early.
           */
          const maxScroll = Math.max(
            1,
            document.documentElement.scrollHeight - window.innerHeight,
          );
          const scrollProgress = Math.max(
            0,
            Math.min(1, window.scrollY / maxScroll),
          );
          const landscapePageTravelLimit = 60;

          pageOffset = -landscapePageTravelLimit * scrollProgress;
        }
        document.documentElement.style.setProperty(
          '--page-parallax-y',
          `${pageOffset.toFixed(2)}px`,
        );
      } else {
        /*
         * Desktop page water:
         * travel continuously from the top of the document to the bottom,
         * rather than remaining fixed at --page-parallax-y: 0.
         */
        const maxScroll = Math.max(
          1,
          document.documentElement.scrollHeight - window.innerHeight,
        );
        const scrollProgress = Math.max(
          0,
          Math.min(1, window.scrollY / maxScroll),
        );
        const desktopPageTravelLimit = 44;
        const pageOffset = -desktopPageTravelLimit * scrollProgress;

        document.documentElement.style.setProperty(
          '--page-parallax-y',
          `${pageOffset.toFixed(2)}px`,
        );
      }

      parallaxItems.forEach((item) => {
        const rect = item.getBoundingClientRect();
        const isLongLivedHeroItem =
          item.classList.contains('banner') &&
          (mobilePortraitParallax.matches || !mobileParallax.matches);

        if (
          !isLongLivedHeroItem &&
          (rect.bottom < -80 || rect.top > window.innerHeight + 80)
        ) return;

        if (!mobileParallax.matches && item.classList.contains('banner')) {
          const heroCard = item.closest('.profile-card');
          const heroBottomDocument = heroCard
            ? heroCard.getBoundingClientRect().bottom + window.scrollY
            : rect.bottom + window.scrollY;

          const heroProgress = Math.max(
            0,
            Math.min(
              1,
              window.scrollY / Math.max(1, heroBottomDocument),
            ),
          );

          /*
           * Positive travel matches the direction we settled on for
           * the mobile hero treatments.
           */
          const desktopHeroTravelLimit = 48;
          const heroOffset = desktopHeroTravelLimit * heroProgress;

          item.style.setProperty(
            '--parallax-y',
            `${heroOffset.toFixed(2)}px`,
          );
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
            ? Math.max(0, window.scrollY * 0.52)
            : Math.max(0, Math.min(92, window.scrollY * 0.40));

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

        /*
         * Mobile landscape About:
         * begin moving as the card enters the viewport and continue
         * continuously until its bottom edge leaves the top of the viewport.
         * Keep the existing +/-50px visual travel, but spread it across the
         * card's complete visible lifetime instead of hitting a clamp early.
         */
        if (
          mobileParallax.matches &&
          !mobilePortraitParallax.matches &&
          item.classList.contains('parallax-bokeh-trail')
        ) {
          const visibleJourney = Math.max(
            0,
            Math.min(
              1,
              (window.innerHeight - rect.top) /
                (window.innerHeight + rect.height),
            ),
          );
          const aboutTravelLimit = 50;
          const aboutOffset =
            -aboutTravelLimit + visibleJourney * aboutTravelLimit * 2;

          item.style.setProperty(
            '--parallax-y',
            `${aboutOffset.toFixed(2)}px`,
          );
          return;
        }

        if (
          !mobileParallax.matches &&
          item.classList.contains('parallax-card')
        ) {
          const visibleJourney = Math.max(
            0,
            Math.min(
              1,
              (window.innerHeight - rect.top) /
                (window.innerHeight + rect.height),
            ),
          );

          let desktopCardTravelLimit = 34;

          if (item.classList.contains('parallax-bokeh-trail')) {
            // About: strongest desktop card treatment.
            desktopCardTravelLimit = 40;
          } else if (item.classList.contains('parallax-water-bokeh')) {
            // Skills + Education/Certifications.
            desktopCardTravelLimit = 36;
          } else if (item.classList.contains('parallax-spiral')) {
            desktopCardTravelLimit = 32;
          }

          const offset =
            -desktopCardTravelLimit +
            visibleJourney * desktopCardTravelLimit * 2;

          item.style.setProperty(
            '--parallax-y',
            `${offset.toFixed(2)}px`,
          );
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
