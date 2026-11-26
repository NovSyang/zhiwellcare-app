/* 下载按钮使用普通链接；脚本仅增强导航和复制，不会自动开始下载。 */
(function () {
  'use strict';

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  var toggle = document.getElementById('navToggle');
  var menu = document.getElementById('navMenu');

  function closeMenu() {
    if (!toggle || !menu) return;
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', '打开菜单');
  }

  /* 与官网相同的移动菜单，同时支持点击空白处和 Escape 关闭。 */
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    });
    document.addEventListener('click', function (event) {
      if (!menu.contains(event.target) && !toggle.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menu.classList.contains('is-open')) {
        closeMenu();
        toggle.focus();
      }
    });
  }

  var status = document.getElementById('download-copy-status');

  /* 自动复制失败时选中文字，用户仍可使用系统的复制功能。 */
  function selectText(target) {
    if (typeof target.select === 'function') {
      target.focus();
      target.select();
      return;
    }
    var selection = window.getSelection();
    if (!selection) return;
    var range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  document.querySelectorAll('[data-copy-target]').forEach(function (button) {
    button.hidden = false;
    button.addEventListener('click', function () {
      var target = document.getElementById(button.getAttribute('data-copy-target'));
      if (!target) return;
      var text = typeof target.value === 'string' ? target.value : target.textContent;
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        selectText(target);
        if (status) status.textContent = '已选中文字，请长按或使用系统复制功能。';
        return;
      }
      navigator.clipboard.writeText(text).then(function () {
        if (status) status.textContent = '已复制，可粘贴到需要的位置。';
      }).catch(function () {
        selectText(target);
        if (status) status.textContent = '暂时无法自动复制，请长按或选中文字复制。';
      });
    });
  });
})();
