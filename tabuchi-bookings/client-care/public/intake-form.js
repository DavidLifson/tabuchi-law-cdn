/**
 * Tabuchi Law Client Care - Multi-Page Branching Intake Form
 * Handles: /intake (public-facing intake form)
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - Multi-step wizard with conditional branching
 * - Auto-save on step change (CC-01 webhook)
 * - Save & resume via session token
 * - Three branches: Estate Planning, Probate, Other
 * - Review & submit final step
 * - Progress bar
 *
 * Page element IDs:
 * - #cc-intake-form         (main form container)
 * - #cc-intake-progress     (progress bar)
 * - #cc-intake-step-title   (current step title)
 * - #cc-intake-step-content (step content area)
 * - #cc-intake-prev-btn     (back button)
 * - #cc-intake-next-btn     (next / submit button)
 * - #cc-intake-save-status  (auto-save indicator)
 */

(function IntakeForm() {
  'use strict';

  var API = ClientCareAPI;
  var $el = function(id) { return document.getElementById(id); };

  // ─── Step Definitions ──────────────────────────────────────────
  // Steps are identified by string keys. Branch logic determines which
  // steps appear based on user selections.

  var STEPS = {
    // Common
    contact: { title: 'Contact Information', branch: 'common', order: 1 },
    service_type: { title: 'Service Type', branch: 'common', order: 2 },

    // Branch A: Estate Planning
    a_personal: { title: 'Personal & Family', branch: 'estate', order: 3 },
    a_guardianship: { title: 'Guardianship', branch: 'estate', order: 4, conditional: true },
    a_executors: { title: 'Executors & Trustees', branch: 'estate', order: 5 },
    a_beneficiaries: { title: 'Beneficiaries', branch: 'estate', order: 6 },
    a_assets: { title: 'Assets Overview', branch: 'estate', order: 7 },
    a_poa: { title: 'Powers of Attorney', branch: 'estate', order: 8 },
    a_special: { title: 'Special Considerations', branch: 'estate', order: 9 },
    a_preferences: { title: 'Preferences & Scheduling', branch: 'estate', order: 10 },

    // Branch B: Probate
    b_deceased: { title: 'Deceased Information', branch: 'probate', order: 3 },
    b_estate_overview: { title: 'Estate Overview', branch: 'probate', order: 4 },
    b_preferences: { title: 'Preferences & Scheduling', branch: 'probate', order: 5 },

    // Branch C: Other
    c_description: { title: 'Tell Us About Your Needs', branch: 'other', order: 3 },

    // Final
    review: { title: 'Review & Submit', branch: 'common', order: 99 }
  };

  // ─── State ───────────────────────────────────────────────────
  var state = {
    currentStep: 'contact',
    sessionId: null,
    formData: {},
    branch: null, // 'estate', 'probate', 'other'
    saving: false,
    submitting: false,
    submitted: false,
    stepHistory: ['contact'] // for back navigation
  };

  // ─── Step Sequence Computation ─────────────────────────────────
  function getStepSequence() {
    var steps = ['contact', 'service_type'];

    if (state.branch === 'estate') {
      steps.push('a_personal');
      if (state.formData.minors_present) {
        steps.push('a_guardianship');
      }
      steps.push('a_executors', 'a_beneficiaries', 'a_assets', 'a_poa', 'a_special', 'a_preferences');
    } else if (state.branch === 'probate') {
      steps.push('b_deceased', 'b_estate_overview', 'b_preferences');
    } else if (state.branch === 'other') {
      steps.push('c_description');
    }

    if (state.branch) {
      steps.push('review');
    }

    return steps;
  }

  function getCurrentStepIndex() {
    return getStepSequence().indexOf(state.currentStep);
  }

  function getTotalSteps() {
    return getStepSequence().length;
  }

  // ─── Navigation ────────────────────────────────────────────────
  function goToStep(stepKey) {
    // Collect data from current step before leaving
    collectCurrentStepData();

    state.currentStep = stepKey;
    state.stepHistory.push(stepKey);
    renderStep();
    autoSave();
  }

  function nextStep() {
    collectCurrentStepData();

    // Determine branch after service_type
    if (state.currentStep === 'service_type') {
      determineBranch();
    }

    // Recompute sequence (may have changed)
    var seq = getStepSequence();
    var idx = seq.indexOf(state.currentStep);
    if (idx < seq.length - 1) {
      goToStep(seq[idx + 1]);
    }
  }

  function prevStep() {
    if (state.stepHistory.length > 1) {
      state.stepHistory.pop(); // Remove current
      var prev = state.stepHistory[state.stepHistory.length - 1];
      state.currentStep = prev;
      renderStep();
    }
  }

  function determineBranch() {
    var pa = state.formData.practice_area || '';
    if (pa.includes('ESTATE') || pa.includes('TRUST') || pa.includes('GUARDIANSHIP')) {
      state.branch = 'estate';
    } else if (pa.includes('PROBATE')) {
      state.branch = 'probate';
    } else if (pa) {
      state.branch = 'other';
    }
  }

  // ─── Collect Step Data ─────────────────────────────────────────
  function collectCurrentStepData() {
    var content = $el('cc-intake-step-content');
    if (!content) return;

    content.querySelectorAll('[data-field]').forEach(function(el) {
      var field = el.dataset.field;
      if (el.type === 'checkbox') {
        state.formData[field] = el.checked;
      } else if (el.type === 'radio') {
        if (el.checked) state.formData[field] = el.value;
      } else {
        state.formData[field] = el.value;
      }
    });

    // Collect dynamic arrays (children, executors, etc.)
    collectDynamicArrays();
  }

  function collectDynamicArrays() {
    var content = $el('cc-intake-step-content');
    if (!content) return;

    content.querySelectorAll('[data-array-field]').forEach(function(container) {
      var arrayField = container.dataset.arrayField;
      var items = [];
      container.querySelectorAll('.cc-array-item').forEach(function(row) {
        var item = {};
        row.querySelectorAll('[data-item-field]').forEach(function(input) {
          item[input.dataset.itemField] = input.type === 'checkbox' ? input.checked : input.value;
        });
        if (Object.values(item).some(function(v) { return v && v !== false; })) {
          items.push(item);
        }
      });
      state.formData[arrayField] = items;
    });
  }

  // ─── Auto-Save ─────────────────────────────────────────────────
  async function autoSave() {
    if (state.saving || state.submitted) return;
    state.saving = true;

    var statusEl = $el('cc-intake-save-status');
    if (statusEl) statusEl.textContent = 'Saving...';

    try {
      var partial = {
        client_name: state.formData.client_name || '',
        client_email: state.formData.client_email || '',
        client_phone: state.formData.client_phone || '',
        client_address: state.formData.client_address || '',
        practice_area: state.formData.practice_area || '',
        service_package: state.formData.service_package || ''
      };

      var result = await API.intake.save({
        session_id: state.sessionId || undefined,
        step_number: getCurrentStepIndex(),
        form_data_partial: partial
      });

      if (result.success && result.session_id) {
        state.sessionId = result.session_id;
        sessionStorage.setItem('cc_intake_session', result.session_id);

        // Update URL with session param for resume
        var url = new URL(window.location);
        url.searchParams.set('session', result.session_id);
        window.history.replaceState(null, '', url.toString());
      }

      if (statusEl) statusEl.textContent = 'Saved';
      setTimeout(function() {
        if (statusEl) statusEl.textContent = '';
      }, 2000);
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Save failed';
    }

    state.saving = false;
  }

  // ─── Resume Session ────────────────────────────────────────────
  async function tryResume() {
    var params = new URLSearchParams(window.location.search);
    var sessionId = params.get('session') || sessionStorage.getItem('cc_intake_session');
    if (!sessionId) return false;

    try {
      var result = await API.intake.resume(sessionId);
      if (result.success && result.form_data) {
        state.sessionId = result.session_id;
        state.formData = result.form_data;
        sessionStorage.setItem('cc_intake_session', result.session_id);

        // Determine branch from restored data
        if (state.formData.practice_area) {
          determineBranch();
        }

        return true;
      }
    } catch (err) {
      // Session expired or not found — start fresh
      sessionStorage.removeItem('cc_intake_session');
    }
    return false;
  }

  // ─── Render Step ───────────────────────────────────────────────
  function renderStep() {
    var content = $el('cc-intake-step-content');
    var titleEl = $el('cc-intake-step-title');
    var prevBtn = $el('cc-intake-prev-btn');
    var nextBtn = $el('cc-intake-next-btn');

    if (!content) return;

    var stepDef = STEPS[state.currentStep];
    if (titleEl) titleEl.textContent = stepDef ? stepDef.title : '';

    // Render progress
    renderProgress();

    // Show/hide nav buttons
    var idx = getCurrentStepIndex();
    var total = getTotalSteps();
    if (prevBtn) prevBtn.style.display = idx > 0 ? '' : 'none';
    if (nextBtn) {
      if (state.currentStep === 'review') {
        nextBtn.textContent = 'Submit';
        nextBtn.className = 'cc-btn cc-btn-primary cc-btn-submit';
      } else {
        nextBtn.textContent = 'Next';
        nextBtn.className = 'cc-btn cc-btn-primary';
      }
      // Disable next if branch not yet chosen on service_type
      if (state.currentStep === 'service_type' && !state.formData.practice_area) {
        nextBtn.disabled = true;
      } else {
        nextBtn.disabled = false;
      }
    }

    // Render step content
    var renderFn = stepRenderers[state.currentStep];
    if (renderFn) {
      content.innerHTML = renderFn();
    } else {
      content.innerHTML = '<p>Step not implemented.</p>';
    }

    // Restore saved values
    restoreFieldValues();

    // Scroll to top
    content.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function renderProgress() {
    var bar = $el('cc-intake-progress');
    if (!bar) return;
    var idx = getCurrentStepIndex();
    var total = getTotalSteps();
    var pct = total > 1 ? Math.round((idx / (total - 1)) * 100) : 0;
    bar.innerHTML = '<div class="cc-progress-track"><div class="cc-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="cc-progress-label">Step ' + (idx + 1) + ' of ' + total + '</span>';
  }

  function restoreFieldValues() {
    var content = $el('cc-intake-step-content');
    if (!content) return;

    content.querySelectorAll('[data-field]').forEach(function(el) {
      var val = state.formData[el.dataset.field];
      if (val === undefined || val === null) return;
      if (el.type === 'checkbox') {
        el.checked = !!val;
      } else if (el.type === 'radio') {
        el.checked = (el.value === val);
      } else {
        el.value = val;
      }
    });
  }

  // ─── Step Renderers ────────────────────────────────────────────
  var stepRenderers = {};

  // STEP 1: Contact Info
  stepRenderers.contact = function() {
    return '' +
      '<div class="cc-form-group">' +
        '<label>Full Legal Name <span class="cc-required">*</span></label>' +
        '<input type="text" data-field="client_name" class="cc-input" required placeholder="e.g. Jane Smith">' +
      '</div>' +
      '<div class="cc-form-row">' +
        '<div class="cc-form-group cc-form-half">' +
          '<label>Email <span class="cc-required">*</span></label>' +
          '<input type="email" data-field="client_email" class="cc-input" required placeholder="email@example.com">' +
        '</div>' +
        '<div class="cc-form-group cc-form-half">' +
          '<label>Phone</label>' +
          '<input type="tel" data-field="client_phone" class="cc-input" placeholder="(416) 555-0123">' +
        '</div>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Address</label>' +
        '<textarea data-field="client_address" class="cc-textarea" rows="3" placeholder="Street address, City, Province, Postal Code"></textarea>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Preferred Language</label>' +
        '<select data-field="language_needs" class="cc-select">' +
          '<option value="">English (default)</option>' +
          '<option value="French">French</option>' +
          '<option value="Mandarin">Mandarin</option>' +
          '<option value="Cantonese">Cantonese</option>' +
          '<option value="Japanese">Japanese</option>' +
          '<option value="Other">Other</option>' +
        '</select>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>How did you hear about us?</label>' +
        '<select data-field="source_detail" class="cc-select">' +
          '<option value="">Select...</option>' +
          '<option value="REFERRAL">Referral from someone</option>' +
          '<option value="WEBFORM">Found online / Google</option>' +
          '<option value="ADS">Online advertisement</option>' +
          '<option value="OTHER">Other</option>' +
        '</select>' +
      '</div>';
  };

  // STEP 2: Service Type Selection
  stepRenderers.service_type = function() {
    var areas = [
      { value: 'ESTATE_PLANNING_WILL_POA', label: 'Estate Planning (Wills & Powers of Attorney)', desc: 'Wills, POAs for property and personal care, basic estate planning' },
      { value: 'TRUSTS_HENSON_SPOUSAL', label: 'Trusts (Henson, Spousal, or other)', desc: 'Special needs trusts, spousal trusts, asset protection trusts' },
      { value: 'GUARDIANSHIP_MINORS', label: 'Guardianship for Minor Children', desc: 'Appointing guardians for children under 18' },
      { value: 'PROBATE_ESTATE_ADMIN', label: 'Probate / Estate Administration', desc: 'Certificate of Appointment, estate settlement, will challenges' },
      { value: 'BUSINESS_SUCCESSION', label: 'Business Succession Planning', desc: 'Business ownership transfer, corporate estate planning' },
      { value: 'REAL_ESTATE', label: 'Real Estate', desc: 'Property transfers, title changes, joint ownership' },
      { value: 'CORPORATE', label: 'Corporate / Commercial', desc: 'Incorporations, shareholder agreements, contracts' },
      { value: 'FAMILY_LAW', label: 'Family Law', desc: 'Separation, divorce, custody, support' }
    ];

    var html = '<p class="cc-step-intro">Select the area of law that best describes your needs. This helps us prepare for your consultation.</p>';
    html += '<div class="cc-radio-cards">';
    areas.forEach(function(area) {
      html += '<label class="cc-radio-card">' +
        '<input type="radio" name="practice_area" data-field="practice_area" value="' + area.value + '">' +
        '<div class="cc-radio-card-content">' +
          '<strong>' + area.label + '</strong>' +
          '<span>' + area.desc + '</span>' +
        '</div>' +
      '</label>';
    });
    html += '</div>';

    // Service package (shown for estate/trusts)
    html += '<div class="cc-form-group cc-mt-4" id="cc-service-pkg-group" style="display:none;">' +
      '<label>Specific Service (optional)</label>' +
      '<select data-field="service_package" class="cc-select">' +
        '<option value="">Not sure yet</option>' +
        '<option value="SIMPLE_WILL_POA">Simple Will & POAs</option>' +
        '<option value="COUPLES_WILLS_POA">Couples Wills & POAs</option>' +
        '<option value="BLENDED_FAMILY_PLAN">Blended Family Plan</option>' +
        '<option value="MINORS_GUARDIANSHIP_PLAN">Minors Guardianship Plan</option>' +
        '<option value="HENSON_TRUST_PLAN">Henson Trust Plan</option>' +
        '<option value="SPOUSAL_TRUST_PLAN">Spousal Trust Plan</option>' +
        '<option value="PROBATE_APPLICATION">Probate Application</option>' +
        '<option value="PROBATE_FULL_ADMIN">Probate Full Administration</option>' +
      '</select>' +
    '</div>';

    return html;
  };

  // BRANCH A: Estate Planning Steps
  stepRenderers.a_personal = function() {
    return '' +
      '<div class="cc-form-group">' +
        '<label>Marital Status</label>' +
        '<select data-field="marital_status" class="cc-select">' +
          '<option value="">Select...</option>' +
          '<option value="SINGLE">Single</option>' +
          '<option value="MARRIED">Married</option>' +
          '<option value="COMMON_LAW">Common-law</option>' +
          '<option value="SEPARATED">Separated</option>' +
          '<option value="DIVORCED">Divorced</option>' +
          '<option value="WIDOWED">Widowed</option>' +
        '</select>' +
      '</div>' +
      '<div id="cc-spouse-fields" class="cc-conditional-section" style="display:none;">' +
        '<div class="cc-form-row">' +
          '<div class="cc-form-group cc-form-half">' +
            '<label>Spouse\'s Full Legal Name</label>' +
            '<input type="text" data-field="spouse_name" class="cc-input">' +
          '</div>' +
          '<div class="cc-form-group cc-form-half">' +
            '<label>Spouse\'s Date of Birth</label>' +
            '<input type="date" data-field="spouse_dob" class="cc-input">' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="cc-form-row">' +
        '<div class="cc-form-group cc-form-half">' +
          '<label>Date of Birth</label>' +
          '<input type="date" data-field="dob" class="cc-input">' +
        '</div>' +
        '<div class="cc-form-group cc-form-half">' +
          '<label>Citizenship</label>' +
          '<input type="text" data-field="citizenship" class="cc-input" placeholder="e.g. Canadian">' +
        '</div>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Do you have children?</label>' +
        '<div class="cc-radio-inline">' +
          '<label><input type="radio" name="has_children" data-field="has_children" value="yes"> Yes</label>' +
          '<label><input type="radio" name="has_children" data-field="has_children" value="no"> No</label>' +
        '</div>' +
      '</div>' +
      '<div id="cc-children-section" class="cc-conditional-section" style="display:none;">' +
        '<div data-array-field="children" class="cc-dynamic-array">' +
          '<div class="cc-array-header"><strong>Children</strong> <button type="button" class="cc-btn-sm cc-btn-add-child">+ Add Child</button></div>' +
          '<div class="cc-array-items"></div>' +
        '</div>' +
        '<div class="cc-form-group cc-mt-2">' +
          '<label><input type="checkbox" data-field="minors_present"> One or more children are under 18</label>' +
        '</div>' +
        '<div class="cc-form-group">' +
          '<label><input type="checkbox" data-field="blended_family"> This is a blended family (children from different relationships)</label>' +
        '</div>' +
      '</div>';
  };

  stepRenderers.a_guardianship = function() {
    return '' +
      '<p class="cc-step-intro">Since you have minor children, we need to discuss guardianship arrangements.</p>' +
      '<div class="cc-form-group">' +
        '<label>Primary Guardian (for minor children)</label>' +
        '<input type="text" data-field="guardian_primary" class="cc-input" placeholder="Full legal name">' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Alternate Guardian</label>' +
        '<input type="text" data-field="guardian_alternate" class="cc-input" placeholder="Full legal name">' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Any special notes or constraints about guardianship?</label>' +
        '<textarea data-field="guardian_notes" class="cc-textarea" rows="3" placeholder="e.g. religious upbringing, location preferences, etc."></textarea>' +
      '</div>';
  };

  stepRenderers.a_executors = function() {
    return '' +
      '<p class="cc-step-intro">Your executor manages your estate after you pass. Choose someone you trust who is organized and responsible.</p>' +
      '<div class="cc-form-group">' +
        '<label>Primary Executor</label>' +
        '<input type="text" data-field="executor_primary" class="cc-input" placeholder="Full legal name">' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Alternate Executor(s)</label>' +
        '<textarea data-field="executor_alternates_text" class="cc-textarea" rows="2" placeholder="One name per line"></textarea>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Executor Compensation</label>' +
        '<select data-field="executor_compensation" class="cc-select">' +
          '<option value="">Select...</option>' +
          '<option value="STANDARD">Standard (set by Ontario law)</option>' +
          '<option value="FIXED">Fixed amount (to be discussed)</option>' +
          '<option value="DISCUSS">I\'d like to discuss options</option>' +
        '</select>' +
      '</div>';
  };

  stepRenderers.a_beneficiaries = function() {
    return '' +
      '<p class="cc-step-intro">Who should receive your estate? List your primary and contingent beneficiaries.</p>' +
      '<div class="cc-form-group">' +
        '<label>Primary Beneficiaries</label>' +
        '<textarea data-field="beneficiaries_primary_text" class="cc-textarea" rows="3" placeholder="Name and relationship, one per line\ne.g. Jane Smith (spouse) - 100%"></textarea>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Contingent Beneficiaries (if primary beneficiaries predecease you)</label>' +
        '<textarea data-field="beneficiaries_contingent_text" class="cc-textarea" rows="3" placeholder="Name and relationship, one per line"></textarea>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Charitable Beneficiaries (optional)</label>' +
        '<textarea data-field="beneficiaries_charity_text" class="cc-textarea" rows="2" placeholder="Charity name and amount/percentage, one per line"></textarea>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label><input type="checkbox" data-field="per_stirpes"> Use "per stirpes" distribution (share goes to deceased beneficiary\'s children)</label>' +
      '</div>';
  };

  stepRenderers.a_assets = function() {
    return '' +
      '<p class="cc-step-intro">A general overview of your assets helps us recommend the right plan.</p>' +
      '<div class="cc-form-group">' +
        '<label>Real Property (homes, land, cottages)</label>' +
        '<textarea data-field="real_property_text" class="cc-textarea" rows="3" placeholder="Address and ownership type, one per line\ne.g. 123 Main St, Mississauga - Joint tenancy with spouse"></textarea>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Registered Accounts (RRSP, TFSA, RRIF) - Do you have beneficiary designations set?</label>' +
        '<select data-field="registered_accounts_known" class="cc-select">' +
          '<option value="">Select...</option>' +
          '<option value="YES">Yes, designations are current</option>' +
          '<option value="NO">No, need to set/update</option>' +
          '<option value="UNKNOWN">Not sure</option>' +
        '</select>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Life Insurance</label>' +
        '<select data-field="life_insurance" class="cc-select">' +
          '<option value="">Select...</option>' +
          '<option value="YES">Yes, I have life insurance</option>' +
          '<option value="NO">No</option>' +
        '</select>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Check all that apply:</label>' +
        '<div class="cc-checkbox-list">' +
          '<label><input type="checkbox" data-field="business_interests"> I have business interests</label>' +
          '<label><input type="checkbox" data-field="foreign_assets"> I have assets outside Canada</label>' +
          '<label><input type="checkbox" data-field="digital_assets"> I have significant digital assets (crypto, online accounts, etc.)</label>' +
        '</div>' +
      '</div>';
  };

  stepRenderers.a_poa = function() {
    return '' +
      '<p class="cc-step-intro">Powers of Attorney designate who can make decisions for you if you become unable to do so.</p>' +
      '<h3>POA for Property (financial decisions)</h3>' +
      '<div class="cc-form-group">' +
        '<label>Attorney for Property</label>' +
        '<input type="text" data-field="poa_property_attorney" class="cc-input" placeholder="Full legal name">' +
      '</div>' +
      '<h3 class="cc-mt-4">POA for Personal Care (health & personal decisions)</h3>' +
      '<div class="cc-form-group">' +
        '<label>Attorney for Personal Care</label>' +
        '<input type="text" data-field="poa_personal_care_attorney" class="cc-input" placeholder="Full legal name">' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Alternate Attorney(s) for both</label>' +
        '<textarea data-field="poa_alternates_text" class="cc-textarea" rows="2" placeholder="One name per line"></textarea>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>If appointing multiple attorneys, should they act:</label>' +
        '<select data-field="poa_joint_or_several" class="cc-select">' +
          '<option value="">Select...</option>' +
          '<option value="JOINT">Jointly (must agree together)</option>' +
          '<option value="SEVERAL">Jointly and severally (can act independently)</option>' +
        '</select>' +
      '</div>';
  };

  stepRenderers.a_special = function() {
    return '' +
      '<p class="cc-step-intro">These questions help us identify if specialized planning may benefit you.</p>' +
      '<div class="cc-checkbox-list cc-special-considerations">' +
        '<label><input type="checkbox" data-field="disabled_beneficiary"> A beneficiary has a disability (may need a Henson Trust)</label>' +
        '<label><input type="checkbox" data-field="spendthrift_risk"> A beneficiary may have difficulty managing money</label>' +
        '<label><input type="checkbox" data-field="creditor_risk"> A beneficiary may face creditor issues</label>' +
        '<label><input type="checkbox" data-field="family_conflict_risk"> There may be family conflict about the estate plan</label>' +
      '</div>' +
      '<div id="cc-henson-note" class="cc-info-box" style="display:none;">' +
        '<strong>Henson Trust:</strong> If a beneficiary receives Ontario Disability Support Program (ODSP) or similar benefits, ' +
        'a Henson Trust can protect their inheritance without affecting their government benefits. We will discuss this with you.' +
      '</div>';
  };

  stepRenderers.a_preferences = function() {
    return renderPreferencesStep();
  };

  // BRANCH B: Probate Steps
  stepRenderers.b_deceased = function() {
    return '' +
      '<div class="cc-form-row">' +
        '<div class="cc-form-group cc-form-half">' +
          '<label>Name of Deceased</label>' +
          '<input type="text" data-field="deceased_name" class="cc-input" placeholder="Full legal name">' +
        '</div>' +
        '<div class="cc-form-group cc-form-half">' +
          '<label>Your Relationship to Deceased</label>' +
          '<input type="text" data-field="relationship_to_deceased" class="cc-input" placeholder="e.g. Spouse, Child, Sibling">' +
        '</div>' +
      '</div>' +
      '<div class="cc-form-row">' +
        '<div class="cc-form-group cc-form-half">' +
          '<label>Date of Birth</label>' +
          '<input type="date" data-field="deceased_dob" class="cc-input">' +
        '</div>' +
        '<div class="cc-form-group cc-form-half">' +
          '<label>Date of Death</label>' +
          '<input type="date" data-field="deceased_date_of_death" class="cc-input">' +
        '</div>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Did the deceased have a Will?</label>' +
        '<select data-field="will_exists" class="cc-select">' +
          '<option value="">Select...</option>' +
          '<option value="yes">Yes</option>' +
          '<option value="no">No</option>' +
          '<option value="unknown">Unknown</option>' +
        '</select>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Is an executor named in the Will?</label>' +
        '<select data-field="executor_named" class="cc-select">' +
          '<option value="">Select...</option>' +
          '<option value="yes">Yes</option>' +
          '<option value="no">No</option>' +
          '<option value="unknown">Unknown / No Will</option>' +
        '</select>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Do you have the death certificate?</label>' +
        '<div class="cc-radio-inline">' +
          '<label><input type="radio" name="death_cert" data-field="death_certificate_available" value="yes"> Yes</label>' +
          '<label><input type="radio" name="death_cert" data-field="death_certificate_available" value="no"> No</label>' +
        '</div>' +
      '</div>';
  };

  stepRenderers.b_estate_overview = function() {
    return '' +
      '<div class="cc-form-group">' +
        '<label>Estimated Estate Value</label>' +
        '<select data-field="estate_value_range" class="cc-select">' +
          '<option value="">Select range...</option>' +
          '<option value="under_50k">Under $50,000</option>' +
          '<option value="50k_150k">$50,000 - $150,000</option>' +
          '<option value="150k_500k">$150,000 - $500,000</option>' +
          '<option value="500k_1m">$500,000 - $1,000,000</option>' +
          '<option value="over_1m">Over $1,000,000</option>' +
          '<option value="unknown">Unknown</option>' +
        '</select>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Does the estate include real property (house, land)?</label>' +
        '<div class="cc-radio-inline">' +
          '<label><input type="radio" name="estate_realprop" data-field="estate_real_property" value="yes"> Yes</label>' +
          '<label><input type="radio" name="estate_realprop" data-field="estate_real_property" value="no"> No</label>' +
        '</div>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Are there any disputes among beneficiaries?</label>' +
        '<div class="cc-radio-inline">' +
          '<label><input type="radio" name="ben_disputes" data-field="beneficiary_disputes" value="yes"> Yes</label>' +
          '<label><input type="radio" name="ben_disputes" data-field="beneficiary_disputes" value="no"> No</label>' +
        '</div>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Are there any urgent deadlines?</label>' +
        '<div class="cc-radio-inline">' +
          '<label><input type="radio" name="urgent" data-field="urgent_deadlines" value="yes"> Yes</label>' +
          '<label><input type="radio" name="urgent" data-field="urgent_deadlines" value="no"> No</label>' +
        '</div>' +
      '</div>';
  };

  stepRenderers.b_preferences = function() {
    return renderPreferencesStep();
  };

  // BRANCH C: Other
  stepRenderers.c_description = function() {
    return '' +
      '<div class="cc-form-group">' +
        '<label>Please describe your legal needs</label>' +
        '<textarea data-field="other_description" class="cc-textarea" rows="5" placeholder="Tell us what you need help with..."></textarea>' +
      '</div>' +
      renderPreferencesStep();
  };

  // Shared: Preferences & Scheduling
  function renderPreferencesStep() {
    return '' +
      '<div class="cc-form-group">' +
        '<label>Preferred Meeting Format</label>' +
        '<select data-field="preferred_meeting_format" class="cc-select">' +
          '<option value="">Select...</option>' +
          '<option value="PHONE">Phone call</option>' +
          '<option value="ZOOM">Zoom video call</option>' +
          '<option value="IN_PERSON">In-person at our office</option>' +
        '</select>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Preferred Date/Time (optional)</label>' +
        '<textarea data-field="scheduling_preferences" class="cc-textarea" rows="2" placeholder="e.g. Weekday afternoons, or specific dates"></textarea>' +
      '</div>' +
      '<div class="cc-form-group">' +
        '<label>Anything else you\'d like us to know?</label>' +
        '<textarea data-field="additional_notes" class="cc-textarea" rows="3" placeholder="Any additional information or questions..."></textarea>' +
      '</div>';
  }

  // FINAL: Review & Submit
  stepRenderers.review = function() {
    var fd = state.formData;
    var html = '<div class="cc-review">';

    // Contact info
    html += '<div class="cc-review-section">';
    html += '<h3>Contact Information</h3>';
    html += reviewField('Name', fd.client_name);
    html += reviewField('Email', fd.client_email);
    html += reviewField('Phone', fd.client_phone);
    html += reviewField('Address', fd.client_address);
    html += '</div>';

    // Service
    html += '<div class="cc-review-section">';
    html += '<h3>Service</h3>';
    html += reviewField('Practice Area', formatPracticeArea(fd.practice_area));
    if (fd.service_package) html += reviewField('Package', fd.service_package.replace(/_/g, ' '));
    html += '</div>';

    // Branch-specific review
    if (state.branch === 'estate') {
      html += '<div class="cc-review-section">';
      html += '<h3>Estate Planning Details</h3>';
      html += reviewField('Marital Status', fd.marital_status);
      if (fd.spouse_name) html += reviewField('Spouse', fd.spouse_name);
      if (fd.executor_primary) html += reviewField('Primary Executor', fd.executor_primary);
      if (fd.guardian_primary) html += reviewField('Primary Guardian', fd.guardian_primary);
      if (fd.poa_property_attorney) html += reviewField('POA Property', fd.poa_property_attorney);
      if (fd.poa_personal_care_attorney) html += reviewField('POA Personal Care', fd.poa_personal_care_attorney);
      if (fd.disabled_beneficiary) html += reviewField('Henson Trust', 'May be recommended');
      html += '</div>';
    } else if (state.branch === 'probate') {
      html += '<div class="cc-review-section">';
      html += '<h3>Probate Details</h3>';
      html += reviewField('Deceased', fd.deceased_name);
      html += reviewField('Relationship', fd.relationship_to_deceased);
      html += reviewField('Will Exists', fd.will_exists);
      html += reviewField('Estate Value', fd.estate_value_range);
      html += '</div>';
    } else if (state.branch === 'other') {
      html += '<div class="cc-review-section">';
      html += '<h3>Description</h3>';
      html += '<p>' + escapeHtml(fd.other_description || '') + '</p>';
      html += '</div>';
    }

    // Meeting preferences
    html += '<div class="cc-review-section">';
    html += '<h3>Meeting Preferences</h3>';
    html += reviewField('Format', fd.preferred_meeting_format);
    if (fd.scheduling_preferences) html += reviewField('Preferred Times', fd.scheduling_preferences);
    html += '</div>';

    // Consent
    html += '<div class="cc-review-section cc-consent-section">';
    html += '<label class="cc-checkbox-label">' +
      '<input type="checkbox" data-field="marketing_consent"> ' +
      'I consent to receiving occasional updates and newsletters from Tabuchi Law. You may unsubscribe at any time.' +
    '</label>';
    html += '</div>';

    html += '<p class="cc-review-note">Please review the information above. Click "Submit" to send your intake form to our team. We will contact you within one business day.</p>';
    html += '</div>';
    return html;
  };

  function reviewField(label, value) {
    if (!value) return '';
    return '<div class="cc-review-field"><span class="cc-review-label">' + label + ':</span> <span class="cc-review-value">' + escapeHtml(String(value).replace(/_/g, ' ')) + '</span></div>';
  }

  // ─── Submit Form ───────────────────────────────────────────────
  async function submitForm() {
    if (state.submitting) return;
    collectCurrentStepData();

    var fd = state.formData;

    // Validate minimum
    if (!fd.client_name || !fd.client_email || !fd.practice_area) {
      showFormError('Please complete all required fields before submitting.');
      return;
    }

    state.submitting = true;
    var nextBtn = $el('cc-intake-next-btn');
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.textContent = 'Submitting...';
    }

    try {
      // Build estate profile sub-object
      var estateData = null;
      if (state.branch === 'estate') {
        estateData = {
          legal_name: fd.client_name,
          dob: fd.dob || null,
          citizenship: fd.citizenship || '',
          marital_status: fd.marital_status || '',
          spouse_name: fd.spouse_name || '',
          children: fd.children || [],
          minors_present: fd.minors_present || false,
          blended_family: fd.blended_family || false,
          executor_primary: fd.executor_primary || '',
          executor_alternates: fd.executor_alternates_text ? fd.executor_alternates_text.split('\n').filter(Boolean) : [],
          executor_compensation: fd.executor_compensation || '',
          guardian_primary: fd.guardian_primary || '',
          guardian_alternate: fd.guardian_alternate || '',
          guardian_notes: fd.guardian_notes || '',
          beneficiaries: {
            primary: fd.beneficiaries_primary_text || '',
            contingent: fd.beneficiaries_contingent_text || '',
            charity: fd.beneficiaries_charity_text || ''
          },
          per_stirpes: fd.per_stirpes || false,
          real_property: fd.real_property_text ? [{ description: fd.real_property_text }] : [],
          registered_accounts_known: fd.registered_accounts_known || '',
          life_insurance: fd.life_insurance || '',
          business_interests: fd.business_interests || false,
          foreign_assets: fd.foreign_assets || false,
          digital_assets: fd.digital_assets || false,
          disabled_beneficiary: fd.disabled_beneficiary || false,
          henson_trust_candidate: fd.disabled_beneficiary || false,
          spendthrift_risk: fd.spendthrift_risk || false,
          creditor_risk: fd.creditor_risk || false,
          family_conflict_risk: fd.family_conflict_risk || false,
          poa_property_attorney: fd.poa_property_attorney || '',
          poa_personal_care_attorney: fd.poa_personal_care_attorney || '',
          poa_alternates: fd.poa_alternates_text ? fd.poa_alternates_text.split('\n').filter(Boolean) : [],
          poa_joint_or_several: fd.poa_joint_or_several || '',
          language_needs: fd.language_needs || '',
          execution_location: fd.preferred_meeting_format === 'IN_PERSON' ? 'OFFICE' : 'REMOTE'
        };
      }

      // Build probate sub-object
      var probateData = null;
      if (state.branch === 'probate') {
        probateData = {
          deceased_name: fd.deceased_name || '',
          deceased_dob: fd.deceased_dob || '',
          date_of_death: fd.deceased_date_of_death || '',
          relationship: fd.relationship_to_deceased || '',
          will_exists: fd.will_exists || '',
          executor_named: fd.executor_named || '',
          death_certificate_available: fd.death_certificate_available || '',
          estate_value_range: fd.estate_value_range || '',
          real_property: fd.estate_real_property || '',
          beneficiary_disputes: fd.beneficiary_disputes || '',
          urgent_deadlines: fd.urgent_deadlines || ''
        };
      }

      var finalData = {
        client_name: fd.client_name,
        client_email: fd.client_email,
        client_phone: fd.client_phone || '',
        client_address: fd.client_address || '',
        practice_area: fd.practice_area,
        service_package: fd.service_package || '',
        source: fd.source_detail || 'WEBFORM',
        preferred_meeting_format: fd.preferred_meeting_format || '',
        scheduling_preferences: fd.scheduling_preferences || '',
        additional_notes: fd.additional_notes || '',
        language_needs: fd.language_needs || ''
      };

      if (estateData) finalData.estate = estateData;
      if (probateData) finalData.probate = probateData;
      if (fd.other_description) finalData.other_description = fd.other_description;

      var consentStatus = fd.marketing_consent ? 'SUBSCRIBED' : 'UNKNOWN';

      var result = await API.intake.submit({
        session_id: state.sessionId,
        final_form_data: finalData,
        consent_status: consentStatus
      });

      if (result.success) {
        state.submitted = true;
        sessionStorage.removeItem('cc_intake_session');
        renderThankYou();
      } else {
        showFormError(result.error || 'Submission failed. Please try again.');
        if (nextBtn) {
          nextBtn.disabled = false;
          nextBtn.textContent = 'Submit';
        }
      }
    } catch (err) {
      showFormError(err.error || 'Network error. Please check your connection and try again.');
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.textContent = 'Submit';
      }
    }

    state.submitting = false;
  }

  function renderThankYou() {
    var content = $el('cc-intake-step-content');
    var progress = $el('cc-intake-progress');
    var title = $el('cc-intake-step-title');
    var prevBtn = $el('cc-intake-prev-btn');
    var nextBtn = $el('cc-intake-next-btn');

    if (progress) progress.style.display = 'none';
    if (title) title.textContent = 'Thank You!';
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';

    if (content) {
      content.innerHTML = '' +
        '<div class="cc-thank-you">' +
          '<div class="cc-thank-you-icon">&#10003;</div>' +
          '<h2>Your intake form has been submitted successfully.</h2>' +
          '<p>Our team will review your information and contact you within one business day to schedule your consultation.</p>' +
          '<p>If you have any urgent questions, please call us at <strong>(905) 595-2225</strong>.</p>' +
          '<a href="https://tabuchilaw.com" class="cc-btn cc-btn-primary">Return to tabuchilaw.com</a>' +
        '</div>';
    }
  }

  function showFormError(message) {
    var content = $el('cc-intake-step-content');
    if (!content) return;
    var existingError = content.querySelector('.cc-form-error');
    if (existingError) existingError.remove();

    var errorDiv = document.createElement('div');
    errorDiv.className = 'cc-form-error';
    errorDiv.textContent = message;
    content.insertBefore(errorDiv, content.firstChild);

    setTimeout(function() { errorDiv.remove(); }, 5000);
  }

  // ─── Conditional Field Logic ───────────────────────────────────
  function bindConditionalLogic() {
    var content = $el('cc-intake-step-content');
    if (!content) return;

    // Service type → show/hide service package
    content.addEventListener('change', function(e) {
      var field = e.target.dataset && e.target.dataset.field;
      if (!field) return;

      // Practice area radio → enable next
      if (field === 'practice_area') {
        var nextBtn = $el('cc-intake-next-btn');
        if (nextBtn) nextBtn.disabled = false;

        // Show service package for estate/trust
        var pkgGroup = document.getElementById('cc-service-pkg-group');
        if (pkgGroup) {
          var val = e.target.value || '';
          pkgGroup.style.display = (val.includes('ESTATE') || val.includes('TRUST') || val.includes('GUARDIANSHIP') || val.includes('PROBATE')) ? '' : 'none';
        }
      }

      // Marital status → show/hide spouse fields
      if (field === 'marital_status') {
        var spouseFields = document.getElementById('cc-spouse-fields');
        if (spouseFields) {
          var needsSpouse = ['MARRIED', 'COMMON_LAW'].includes(e.target.value);
          spouseFields.style.display = needsSpouse ? '' : 'none';
        }
      }

      // Has children → show/hide children section
      if (field === 'has_children') {
        var childSection = document.getElementById('cc-children-section');
        if (childSection) {
          childSection.style.display = e.target.value === 'yes' ? '' : 'none';
        }
      }

      // Disabled beneficiary → show Henson note
      if (field === 'disabled_beneficiary') {
        var note = document.getElementById('cc-henson-note');
        if (note) {
          note.style.display = e.target.checked ? '' : 'none';
        }
      }
    });

    // Add child button
    content.addEventListener('click', function(e) {
      if (e.target.classList.contains('cc-btn-add-child')) {
        addChildRow();
      }
      if (e.target.classList.contains('cc-btn-remove-child')) {
        e.target.closest('.cc-array-item').remove();
      }
    });
  }

  function addChildRow() {
    var container = document.querySelector('[data-array-field="children"] .cc-array-items');
    if (!container) return;

    var row = document.createElement('div');
    row.className = 'cc-array-item';
    row.innerHTML = '' +
      '<div class="cc-form-row">' +
        '<input type="text" data-item-field="name" class="cc-input cc-input-sm" placeholder="Child\'s name">' +
        '<input type="date" data-item-field="dob" class="cc-input cc-input-sm" placeholder="DOB">' +
        '<select data-item-field="type" class="cc-select cc-select-sm">' +
          '<option value="biological">Biological</option>' +
          '<option value="step">Step</option>' +
          '<option value="adopted">Adopted</option>' +
        '</select>' +
        '<button type="button" class="cc-btn-sm cc-btn-remove-child" title="Remove">&times;</button>' +
      '</div>';
    container.appendChild(row);
  }

  // ─── Helpers ─────────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatPracticeArea(pa) {
    if (!pa) return '';
    return pa.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }).replace(/\bPoa\b/g, 'POA');
  }

  // ─── Initialize ──────────────────────────────────────────────
  async function init() {
    // Try to resume saved session
    var resumed = await tryResume();

    // Bind nav buttons
    var prevBtn = $el('cc-intake-prev-btn');
    var nextBtn = $el('cc-intake-next-btn');

    if (prevBtn) {
      prevBtn.addEventListener('click', function() {
        prevStep();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function() {
        if (state.currentStep === 'review') {
          submitForm();
        } else {
          nextStep();
        }
      });
    }

    // Bind conditional logic (delegated to step content area)
    var content = $el('cc-intake-step-content');
    if (content) {
      // Use MutationObserver to rebind after step content changes
      var observer = new MutationObserver(function() {
        bindConditionalLogic();
      });
      observer.observe(content, { childList: true });
    }

    // Render first step
    renderStep();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
