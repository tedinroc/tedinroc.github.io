(() => {
  const filters = [...document.querySelectorAll('[data-filter]')];
  const projects = [...document.querySelectorAll('[data-category]')];
  const live = document.querySelector('#filter-result');
  const chinese = document.documentElement.lang === 'zh-Hant';
  // The complete portfolio stays visible if JavaScript is unavailable.
  document.querySelector('.filters')?.removeAttribute('hidden');
  for (const button of filters) {
    button.addEventListener('click', () => {
      const category = button.dataset.filter;
      for (const option of filters) option.setAttribute('aria-pressed', String(option === button));
      let count = 0;
      for (const project of projects) {
        project.hidden = category !== 'all' && !project.dataset.category.split(' ').includes(category);
        if (!project.hidden) count++;
      }
      if (live) live.textContent = chinese ? `顯示 ${count} 件作品` : `Showing ${count} projects`;
    });
  }
})();
