/**
 * Dashboard Categories Management Page
 * Admin-only page for managing meeting type categories.
 * Source: webflow/dashboard/categories.js
 */

(async function CategoriesManagementPage() {
  'use strict';

  const _root = document.querySelector('#tb-page-root');
  const $el = (id) => _root?.querySelector(`#${id}`) ?? document.getElementById(id);
  const showEl = (id) => { const el = $el(id); if (el) el.style.display = ''; };
  const hideEl = (id) => { const el = $el(id); if (el) el.style.display = 'none'; };
  const setText = (id, t) => { const el = $el(id); if (el) el.textContent = t || ''; };

  // Check dashboard auth
  const dashboardToken = localStorage.getItem('app_token');
  if (!dashboardToken) { window.location.href = '/login'; return; }

  // Check admin role
  let isAdmin = false;
  try {
    const staffInfo = JSON.parse(localStorage.getItem('app_user') || '{}');
    isAdmin = !!staffInfo.is_admin;
  } catch (e) { /* ignore */ }

  // Insert admin dropdown in nav
  if (isAdmin) {
    const logoutLink = _root?.querySelector('a[href="/login?logout"]');
    if (logoutLink) {
      const adminWrap = document.createElement('div');
      adminWrap.style.cssText = 'position:relative;display:inline-block;';
      const adminBtn = document.createElement('button');
      adminBtn.style.cssText = 'color:#D1D5DB;background:none;border:1px solid #4B5563;cursor:pointer;padding:0.3rem 0.6rem;font-size:0.9rem;border-radius:4px;font-family:inherit;';
      adminBtn.textContent = 'Admin \u25BE';
      const adminMenu = document.createElement('div');
      adminMenu.style.cssText = 'display:none;position:absolute;right:0;top:100%;margin-top:2px;background:#1F2937;border:1px solid #4B5563;border-radius:4px;min-width:130px;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
      adminMenu.innerHTML = '<a href="/dashboard-staff" style="display:block;color:#D1D5DB;text-decoration:none;padding:0.5rem 0.8rem;font-size:0.85rem;">Staff</a>'
        + '<a href="/dashboard-categories" style="display:block;color:#D1D5DB;text-decoration:none;padding:0.5rem 0.8rem;font-size:0.85rem;">Categories</a>';
      adminWrap.appendChild(adminBtn);
      adminWrap.appendChild(adminMenu);
      adminBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        adminMenu.style.display = adminMenu.style.display === 'none' ? 'block' : 'none';
      });
      document.addEventListener('click', () => { adminMenu.style.display = 'none'; });
      logoutLink.parentNode.insertBefore(adminWrap, logoutLink);
      const currentPath = window.location.pathname;
      adminMenu.querySelectorAll('a').forEach((a) => {
        if (a.getAttribute('href') === currentPath) {
          a.style.background = '#374151';
          a.style.color = 'white';
        }
      });
    }
  }

  if (!isAdmin) {
    showEl('tb-access-denied');
    hideEl('tb-categories-content');
    return;
  }

  // Admin user - show content and load categories
  showEl('tb-categories-content');
  let categories = [];

  // Add category handlers
  const addBtn = $el('tb-cat-add-btn');
  const addInput = $el('tb-cat-input');
  addBtn?.addEventListener('click', addCategory);
  addInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCategory();
  });

  await loadCategories();

  // ─── Load Categories ─────────────────────────────────────────

  async function loadCategories() {
    const listEl = $el('tb-cat-list');
    if (listEl) listEl.innerHTML = '<div style="padding:1rem;text-align:center;color:#6B7280;">Loading...</div>';

    try {
      const result = await TabuchiAPI.admin.categories('list');
      categories = result.categories || [];
      renderCategories();
    } catch (err) {
      if (err.status === 401) { window.location.href = '/login'; return; }
      if (listEl) listEl.innerHTML = `<div style="padding:1rem;color:#DC2626;">${err.error || 'Unable to load categories.'}</div>`;
    }
  }

  // ─── Render Categories ───────────────────────────────────────

  function renderCategories() {
    const listEl = $el('tb-cat-list');
    if (!listEl) return;

    setText('tb-cat-count', `${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`);

    if (categories.length === 0) {
      listEl.innerHTML = '<div style="padding:1rem;text-align:center;color:#6B7280;">No categories yet. Add one above.</div>';
      return;
    }

    listEl.innerHTML = categories.map((cat) =>
      `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 1rem;border-bottom:1px solid #F3F4F6;">
        <span style="font-size:0.95rem;">${cat.name || ''}</span>
        <button data-cat-id="${cat.id}" class="tb-cat-delete" style="background:none;border:none;color:#EF4444;cursor:pointer;font-size:1.1rem;padding:0.2rem 0.5rem;border-radius:4px;line-height:1;" title="Delete">&times;</button>
      </div>`
    ).join('');

    // Attach delete handlers
    listEl.querySelectorAll('.tb-cat-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-cat-id');
        const name = btn.parentNode.querySelector('span').textContent;
        if (confirm(`Delete category "${name}"?`)) {
          deleteCategory(id);
        }
      });
    });
  }

  // ─── Add Category ────────────────────────────────────────────

  async function addCategory() {
    const input = $el('tb-cat-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) { input.focus(); return; }

    const btn = $el('tb-cat-add-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }

    try {
      const result = await TabuchiAPI.admin.categories('add', { name });
      categories = result.categories || [];
      renderCategories();
      input.value = '';
      input.focus();
    } catch (err) {
      alert(err.error || 'Failed to add category.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Add'; }
    }
  }

  // ─── Delete Category ─────────────────────────────────────────

  async function deleteCategory(id) {
    try {
      const result = await TabuchiAPI.admin.categories('delete', { id });
      categories = result.categories || [];
      renderCategories();
    } catch (err) {
      alert(err.error || 'Failed to delete category.');
    }
  }
})();
