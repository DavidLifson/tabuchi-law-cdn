/**
 * Tabuchi Law Client Care - JSON-Config-Driven Intake Form Engine
 * Handles: /intake?form=<formId> (public-facing intake forms)
 *
 * Requires: cc-api-client.js loaded first, then a form config on window.IntakeFormConfigs
 *
 * Features:
 * - Reads form definition from window.IntakeFormConfigs[formId]
 * - Multi-step wizard with conditional branching (show_if)
 * - Auto-save on step change (CC-01 webhook)
 * - Save & resume via session token
 * - YouTube video embeds per step
 * - File upload with Azure Blob Storage
 * - Auto-generated review step
 * - Progress bar
 *
 * Page element IDs (from embed HTML):
 * - #cc-intake-form         (main form container)
 * - #cc-intake-progress     (progress bar)
 * - #cc-intake-step-title   (current step title)
 * - #cc-intake-step-content (step content area)
 * - #cc-intake-prev-btn     (back button)
 * - #cc-intake-next-btn     (next / submit button)
 * - #cc-intake-save-status  (auto-save indicator)
 */

(function IntakeEngine() {
  'use strict';

  var API = window.ClientCareAPI || (typeof ClientCareAPI !== 'undefined' ? ClientCareAPI : null);
  if (!API) return;

  var $el = function(id) { return document.getElementById(id); };

  // ─── State ───────────────────────────────────────────────────
  var state = {
    formId: null,
    config: null,
    isDynamic: false,
    isPreview: false,
    currentStepIndex: 0,
    sessionId: null,
    formData: {},
    uploadedFiles: {},
    saving: false,
    submitting: false,
    submitted: false,
    stepHistory: [0]
  };

  // ─── Escaping ────────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── Step Sequence with Conditional Branching ────────────────
  function getAllSteps() {
    if (!state.config) return [];
    var steps = [];
    state.config.sections.forEach(function(section) {
      section.steps.forEach(function(step) {
        steps.push({ step: step, sectionId: section.id, sectionTitle: section.title });
      });
    });
    return steps;
  }

  function getVisibleSteps() {
    return getAllSteps().filter(function(item) {
      return evaluateCondition(item.step.show_if);
    });
  }

  function evaluateCondition(cond) {
    if (!cond) return true;

    // Support AND conditions (array of conditions)
    if (Array.isArray(cond)) {
      return cond.every(function(c) { return evaluateCondition(c); });
    }

    var val = state.formData[cond.field];
    switch (cond.op) {
      case 'eq': return val === cond.value;
      case 'neq': return val !== cond.value;
      case 'in': return Array.isArray(cond.value) && cond.value.indexOf(val) !== -1;
      case 'not_in': return Array.isArray(cond.value) && cond.value.indexOf(val) === -1;
      case 'truthy': return !!val;
      case 'falsy': return !val;
      default: return true;
    }
  }

  function getCurrentStepItem() {
    var steps = getVisibleSteps();
    return steps[state.currentStepIndex] || null;
  }

  function isReviewStep() {
    var steps = getVisibleSteps();
    return state.currentStepIndex === steps.length; // one past the last config step
  }

  function getTotalSteps() {
    return getVisibleSteps().length + 1; // +1 for review
  }

  // ─── Navigation ────────────────────────────────────────────────
  function nextStep() {
    // Validate current step
    if (!isReviewStep()) {
      if (!validateCurrentStep()) return;
    }

    collectCurrentStepData();

    var total = getTotalSteps();
    if (state.currentStepIndex < total - 1) {
      // Recompute visible steps after data collection (branching may change)
      var newVisible = getVisibleSteps();
      var nextIdx = state.currentStepIndex + 1;

      // Ensure next index is valid after recomputation
      if (nextIdx > newVisible.length) nextIdx = newVisible.length; // review step

      state.currentStepIndex = nextIdx;
      state.stepHistory.push(nextIdx);
      renderStep();
      autoSave();
    }
  }

  function prevStep() {
    if (state.stepHistory.length > 1) {
      collectCurrentStepData();
      state.stepHistory.pop();
      state.currentStepIndex = state.stepHistory[state.stepHistory.length - 1];
      renderStep();
    }
  }

  // ─── Data Collection ─────────────────────────────────────────
  function collectCurrentStepData() {
    var content = $el('cc-intake-step-content');
    if (!content) return;

    // Simple fields
    var checkboxGroupValues = {};
    content.querySelectorAll('[data-field]').forEach(function(el) {
      var field = el.dataset.field;
      if (el.type === 'checkbox' && el.name === field && el.closest('.cc-intake-checkbox-group')) {
        // Checkbox group: collect all checked values into an array
        if (!checkboxGroupValues[field]) checkboxGroupValues[field] = [];
        if (el.checked) checkboxGroupValues[field].push(el.value);
      } else if (el.type === 'checkbox') {
        state.formData[field] = el.checked;
      } else if (el.type === 'radio') {
        if (el.checked) state.formData[field] = el.value;
      } else {
        var val = el.value.trim();
        if (val !== '') state.formData[field] = val;
      }
    });
    // Apply checkbox group values
    Object.keys(checkboxGroupValues).forEach(function(field) {
      state.formData[field] = checkboxGroupValues[field];
    });

    // Address compound fields
    content.querySelectorAll('[data-address-field]').forEach(function(container) {
      var fieldId = container.dataset.addressField;
      var parts = {};
      container.querySelectorAll('[data-address-part]').forEach(function(input) {
        parts[input.dataset.addressPart] = input.value.trim();
      });
      // Combine into single address string
      var addrParts = [parts.street, parts.city, parts.province, parts.postal_code].filter(Boolean);
      if (addrParts.length > 0) {
        state.formData[fieldId] = addrParts.join(', ');
      }
      // Also store individual parts
      Object.keys(parts).forEach(function(key) {
        if (parts[key]) state.formData[fieldId + '_' + key] = parts[key];
      });
    });
  }

  // ─── Restore Values ──────────────────────────────────────────
  function restoreFieldValues() {
    var content = $el('cc-intake-step-content');
    if (!content) return;

    content.querySelectorAll('[data-field]').forEach(function(el) {
      var val = state.formData[el.dataset.field];
      if (val === undefined || val === null) return;
      if (el.type === 'checkbox' && el.closest('.cc-intake-checkbox-group')) {
        // Checkbox group: check if value is in the array
        el.checked = Array.isArray(val) && val.indexOf(el.value) !== -1;
      } else if (el.type === 'checkbox') {
        el.checked = !!val;
      } else if (el.type === 'radio') {
        el.checked = (el.value === String(val));
        if (el.checked) {
          // Visually update radio card
          var card = el.closest('.cc-intake-radio-item');
          if (card) card.classList.add('cc-intake-radio-selected');
        }
      } else {
        el.value = val;
      }
    });

    // Restore address parts
    content.querySelectorAll('[data-address-field]').forEach(function(container) {
      var fieldId = container.dataset.addressField;
      container.querySelectorAll('[data-address-part]').forEach(function(input) {
        var partVal = state.formData[fieldId + '_' + input.dataset.addressPart];
        if (partVal) input.value = partVal;
      });
    });

    // Restore file upload previews
    content.querySelectorAll('[data-upload-field]').forEach(function(container) {
      var fieldId = container.dataset.uploadField;
      var fileInfo = state.uploadedFiles[fieldId];
      if (fileInfo) {
        showUploadPreview(container, fileInfo);
      }
    });
  }

  // ─── Validation ──────────────────────────────────────────────
  function validateCurrentStep() {
    var item = getCurrentStepItem();
    if (!item) return true;

    var content = $el('cc-intake-step-content');
    if (!content) return true;

    var errors = [];
    var firstErrorEl = null;

    // Clear previous errors
    content.querySelectorAll('.cc-field-error').forEach(function(el) { el.remove(); });
    content.querySelectorAll('.cc-input-error').forEach(function(el) { el.classList.remove('cc-input-error'); });

    item.step.fields.forEach(function(field) {
      var val = getFieldValue(content, field);

      if (field.required && !val) {
        errors.push({ fieldId: field.id, message: (field.label || field.id) + ' is required' });
      }

      if (val && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        errors.push({ fieldId: field.id, message: 'Please enter a valid email address' });
      }

      if (val && field.type === 'phone' && !/^[\d\s()+\-\.]{7,}$/.test(val)) {
        errors.push({ fieldId: field.id, message: 'Please enter a valid phone number' });
      }

      if (field.type === 'file_upload' && field.required) {
        // Check each sub-field
        var subFields = field.sub_fields || [{ id: field.id }];
        subFields.forEach(function(sf) {
          if (!state.uploadedFiles[sf.id]) {
            errors.push({ fieldId: sf.id, message: (sf.label || field.label) + ' is required' });
          }
        });
      }
    });

    // Show errors
    errors.forEach(function(err) {
      var el = content.querySelector('[data-field="' + escapeAttr(err.fieldId) + '"]') ||
               content.querySelector('[data-upload-field="' + escapeAttr(err.fieldId) + '"]');
      if (el) {
        var wrapper = el.closest('.cc-intake-field-group') || el.parentElement;
        if (wrapper && !wrapper.querySelector('.cc-field-error')) {
          el.classList.add('cc-input-error');
          var errDiv = document.createElement('div');
          errDiv.className = 'cc-field-error';
          errDiv.textContent = err.message;
          wrapper.appendChild(errDiv);
          if (!firstErrorEl) firstErrorEl = wrapper;
        }
      }
    });

    if (firstErrorEl) {
      firstErrorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return errors.length === 0;
  }

  function getFieldValue(content, field) {
    if (field.type === 'multiple_choice' || field.type === 'yes_no') {
      var checked = content.querySelector('[data-field="' + escapeAttr(field.id) + '"]:checked');
      return checked ? checked.value : '';
    }
    if (field.type === 'checkbox_group') {
      var checkedBoxes = content.querySelectorAll('[data-field="' + escapeAttr(field.id) + '"]:checked');
      return checkedBoxes.length > 0 ? Array.from(checkedBoxes).map(function(el) { return el.value; }) : '';
    }
    if (field.type === 'address') {
      var container = content.querySelector('[data-address-field="' + escapeAttr(field.id) + '"]');
      if (!container) return '';
      var parts = [];
      container.querySelectorAll('[data-address-part]').forEach(function(input) {
        if (input.value.trim()) parts.push(input.value.trim());
      });
      return parts.length > 0 ? parts.join(', ') : '';
    }
    if (field.type === 'file_upload') return ''; // validated separately
    var el = content.querySelector('[data-field="' + escapeAttr(field.id) + '"]');
    return el ? el.value.trim() : '';
  }

  // ─── Field Renderers ─────────────────────────────────────────
  var fieldRenderers = {};

  fieldRenderers.short_text = function(field) {
    var group = createFieldGroup(field);
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'cc-input';
    input.setAttribute('data-field', field.id);
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.required) input.required = true;
    group.appendChild(input);
    return group;
  };

  fieldRenderers.long_text = function(field) {
    var group = createFieldGroup(field);
    var textarea = document.createElement('textarea');
    textarea.className = 'cc-textarea';
    textarea.setAttribute('data-field', field.id);
    textarea.rows = field.rows || 4;
    if (field.placeholder) textarea.placeholder = field.placeholder;
    if (field.required) textarea.required = true;
    group.appendChild(textarea);
    return group;
  };

  fieldRenderers.email = function(field) {
    var group = createFieldGroup(field);
    var input = document.createElement('input');
    input.type = 'email';
    input.className = 'cc-input';
    input.setAttribute('data-field', field.id);
    if (field.placeholder) input.placeholder = field.placeholder || 'email@example.com';
    if (field.required) input.required = true;
    group.appendChild(input);
    return group;
  };

  fieldRenderers.phone = function(field) {
    var group = createFieldGroup(field);
    var input = document.createElement('input');
    input.type = 'tel';
    input.className = 'cc-input';
    input.setAttribute('data-field', field.id);
    if (field.placeholder) input.placeholder = field.placeholder || '(416) 555-0123';
    if (field.required) input.required = true;
    group.appendChild(input);
    return group;
  };

  fieldRenderers.number = function(field) {
    var group = createFieldGroup(field);
    var input = document.createElement('input');
    input.type = 'number';
    input.className = 'cc-input';
    input.setAttribute('data-field', field.id);
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.required) input.required = true;
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined) input.max = field.max;
    group.appendChild(input);
    return group;
  };

  fieldRenderers.date = function(field) {
    var group = createFieldGroup(field);
    var input = document.createElement('input');
    input.type = 'date';
    input.className = 'cc-input';
    input.setAttribute('data-field', field.id);
    if (field.required) input.required = true;
    group.appendChild(input);
    return group;
  };

  fieldRenderers.address = function(field) {
    var group = createFieldGroup(field);
    var container = document.createElement('div');
    container.className = 'cc-address-fields';
    container.setAttribute('data-address-field', field.id);

    var parts = [
      { key: 'street', label: 'Street Address', placeholder: '123 Main St', colspan: 'full' },
      { key: 'city', label: 'City', placeholder: 'Mississauga' },
      { key: 'province', label: 'Province', placeholder: 'Ontario', type: 'select',
        options: ['', 'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick',
                  'Newfoundland and Labrador', 'Northwest Territories', 'Nova Scotia',
                  'Nunavut', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Yukon'] },
      { key: 'postal_code', label: 'Postal Code', placeholder: 'L5B 1M2' }
    ];

    parts.forEach(function(part) {
      var partGroup = document.createElement('div');
      partGroup.className = 'cc-address-part' + (part.colspan === 'full' ? ' cc-address-full' : '');

      var label = document.createElement('label');
      label.className = 'cc-intake-field-sublabel';
      label.textContent = part.label;
      partGroup.appendChild(label);

      var input;
      if (part.type === 'select') {
        input = document.createElement('select');
        input.className = 'cc-select';
        part.options.forEach(function(opt) {
          var option = document.createElement('option');
          option.value = opt;
          option.textContent = opt || 'Select...';
          input.appendChild(option);
        });
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'cc-input';
        if (part.placeholder) input.placeholder = part.placeholder;
      }
      input.setAttribute('data-address-part', part.key);
      partGroup.appendChild(input);
      container.appendChild(partGroup);
    });

    group.appendChild(container);
    return group;
  };

  fieldRenderers.multiple_choice = function(field) {
    var group = createFieldGroup(field);
    var radioGroup = document.createElement('div');
    radioGroup.className = 'cc-intake-radio-group';

    (field.options || []).forEach(function(opt) {
      var label = document.createElement('label');
      label.className = 'cc-intake-radio-item';

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = field.id;
      input.value = opt.value;
      input.setAttribute('data-field', field.id);
      input.style.display = 'none';

      var textDiv = document.createElement('div');
      textDiv.className = 'cc-radio-card-content';
      var strong = document.createElement('strong');
      strong.textContent = opt.label;
      textDiv.appendChild(strong);
      if (opt.description) {
        var desc = document.createElement('span');
        desc.className = 'cc-radio-card-desc';
        desc.textContent = opt.description;
        textDiv.appendChild(desc);
      }

      label.appendChild(input);
      label.appendChild(textDiv);

      // Click handling for visual state
      input.addEventListener('change', function() {
        radioGroup.querySelectorAll('.cc-intake-radio-item').forEach(function(item) {
          item.classList.remove('cc-intake-radio-selected');
        });
        label.classList.add('cc-intake-radio-selected');
      });

      radioGroup.appendChild(label);
    });

    group.appendChild(radioGroup);
    return group;
  };

  fieldRenderers.yes_no = function(field) {
    var yesNoField = Object.assign({}, field, {
      type: 'multiple_choice',
      options: [
        { value: 'yes', label: field.yes_label || 'Yes' },
        { value: 'no', label: field.no_label || 'No' }
      ]
    });
    return fieldRenderers.multiple_choice(yesNoField);
  };

  fieldRenderers.select = function(field) {
    var group = createFieldGroup(field);
    var select = document.createElement('select');
    select.className = 'cc-select';
    select.setAttribute('data-field', field.id);
    if (field.required) select.required = true;

    // Add placeholder option
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = field.placeholder || 'Select...';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    (field.options || []).forEach(function(opt) {
      var option = document.createElement('option');
      option.value = opt.value || opt;
      option.textContent = opt.label || opt;
      select.appendChild(option);
    });

    group.appendChild(select);
    return group;
  };

  fieldRenderers.checkbox_group = function(field) {
    var group = createFieldGroup(field);
    var container = document.createElement('div');
    container.className = 'cc-intake-checkbox-group';

    (field.options || []).forEach(function(opt) {
      var label = document.createElement('label');
      label.className = 'cc-intake-checkbox-item';

      var input = document.createElement('input');
      input.type = 'checkbox';
      input.name = field.id;
      input.value = opt.value || opt;
      input.setAttribute('data-field', field.id);
      input.className = 'cc-checkbox';

      var span = document.createElement('span');
      span.className = 'cc-checkbox-label';
      span.textContent = opt.label || opt;

      label.appendChild(input);
      label.appendChild(span);

      if (opt.description) {
        var desc = document.createElement('span');
        desc.className = 'cc-checkbox-desc';
        desc.textContent = opt.description;
        label.appendChild(desc);
      }

      container.appendChild(label);
    });

    group.appendChild(container);
    return group;
  };

  fieldRenderers.file_upload = function(field) {
    var group = createFieldGroup(field);
    var subFields = field.sub_fields || [{ id: field.id, label: field.label }];

    subFields.forEach(function(sf) {
      var uploadContainer = document.createElement('div');
      uploadContainer.className = 'cc-upload-zone';
      uploadContainer.setAttribute('data-upload-field', sf.id);

      if (sf.label && subFields.length > 1) {
        var subLabel = document.createElement('div');
        subLabel.className = 'cc-upload-sublabel';
        subLabel.textContent = sf.label;
        uploadContainer.appendChild(subLabel);
      }

      var dropZone = document.createElement('div');
      dropZone.className = 'cc-upload-dropzone';

      var icon = document.createElement('div');
      icon.className = 'cc-upload-icon';
      icon.innerHTML = '&#128247;'; // camera icon

      var text = document.createElement('div');
      text.className = 'cc-upload-text';
      text.textContent = 'Drag & drop or click to upload';

      var hint = document.createElement('div');
      hint.className = 'cc-upload-hint';
      hint.textContent = 'JPG, PNG, or PDF (max 10MB)';

      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*,.pdf';
      fileInput.className = 'cc-upload-input';
      fileInput.style.display = 'none';

      var previewContainer = document.createElement('div');
      previewContainer.className = 'cc-upload-preview';
      previewContainer.style.display = 'none';

      dropZone.appendChild(icon);
      dropZone.appendChild(text);
      dropZone.appendChild(hint);
      dropZone.appendChild(fileInput);

      // Click to upload
      dropZone.addEventListener('click', function() { fileInput.click(); });

      // Drag and drop
      dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropZone.classList.add('cc-upload-dragover');
      });
      dropZone.addEventListener('dragleave', function() {
        dropZone.classList.remove('cc-upload-dragover');
      });
      dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.classList.remove('cc-upload-dragover');
        if (e.dataTransfer.files.length > 0) {
          handleFileUpload(sf.id, e.dataTransfer.files[0], uploadContainer);
        }
      });

      // File input change
      fileInput.addEventListener('change', function() {
        if (fileInput.files.length > 0) {
          handleFileUpload(sf.id, fileInput.files[0], uploadContainer);
        }
      });

      uploadContainer.appendChild(dropZone);
      uploadContainer.appendChild(previewContainer);
      group.appendChild(uploadContainer);
    });

    return group;
  };

  fieldRenderers.info = function(field) {
    var group = document.createElement('div');
    group.className = 'cc-intake-field-group cc-intake-info';
    var p = document.createElement('p');
    p.className = 'cc-intake-info-text';
    p.textContent = field.text || field.label;
    group.appendChild(p);
    return group;
  };

  // ─── Field Group Helper ──────────────────────────────────────
  function createFieldGroup(field) {
    var group = document.createElement('div');
    group.className = 'cc-intake-field-group';

    if (field.label && field.type !== 'info') {
      var label = document.createElement('label');
      label.className = 'cc-intake-field-label' + (field.required ? ' cc-intake-field-required' : '');
      label.textContent = field.label;
      group.appendChild(label);
    }

    if (field.description) {
      var desc = document.createElement('p');
      desc.className = 'cc-intake-field-desc';
      desc.textContent = field.description;
      group.appendChild(desc);
    }

    return group;
  }

  // ─── Video Embed ─────────────────────────────────────────────
  function renderVideo(videoId) {
    var wrapper = document.createElement('div');
    wrapper.className = 'cc-intake-video';

    var iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + escapeAttr(videoId);
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('frameborder', '0');
    iframe.title = 'Instructional Video';
    wrapper.appendChild(iframe);

    return wrapper;
  }

  // ─── File Upload ─────────────────────────────────────────────
  async function handleFileUpload(fieldId, file, container) {
    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      showFieldError(container, 'File must be under 10MB');
      return;
    }

    // Validate file type
    var validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (validTypes.indexOf(file.type) === -1) {
      showFieldError(container, 'Please upload an image (JPG, PNG) or PDF');
      return;
    }

    var dropZone = container.querySelector('.cc-upload-dropzone');
    var previewEl = container.querySelector('.cc-upload-preview');

    // Show uploading state
    if (dropZone) dropZone.style.display = 'none';
    if (previewEl) {
      previewEl.style.display = '';
      previewEl.innerHTML = '';
      var spinner = document.createElement('div');
      spinner.className = 'cc-upload-progress';
      spinner.textContent = 'Uploading...';
      previewEl.appendChild(spinner);
    }

    try {
      var result = await API.intake.uploadFile(state.sessionId, fieldId, file);

      if (result.success) {
        state.uploadedFiles[fieldId] = {
          blob_path: result.blob_path,
          preview_url: result.preview_url,
          filename: file.name,
          content_type: file.type
        };
        showUploadPreview(container, state.uploadedFiles[fieldId]);
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (err) {
      console.error('File upload error:', err);
      if (dropZone) dropZone.style.display = '';
      if (previewEl) previewEl.style.display = 'none';
      showFieldError(container, 'Upload failed. Please try again.');
    }
  }

  function showUploadPreview(container, fileInfo) {
    var dropZone = container.querySelector('.cc-upload-dropzone');
    var previewEl = container.querySelector('.cc-upload-preview');

    if (dropZone) dropZone.style.display = 'none';
    if (!previewEl) return;

    previewEl.style.display = '';
    previewEl.innerHTML = '';

    var previewCard = document.createElement('div');
    previewCard.className = 'cc-upload-preview-card';

    if (fileInfo.content_type && fileInfo.content_type.startsWith('image/') && fileInfo.preview_url) {
      var img = document.createElement('img');
      img.src = fileInfo.preview_url;
      img.alt = fileInfo.filename;
      img.className = 'cc-upload-thumbnail';
      previewCard.appendChild(img);
    } else {
      var fileIcon = document.createElement('div');
      fileIcon.className = 'cc-upload-file-icon';
      fileIcon.textContent = 'PDF';
      previewCard.appendChild(fileIcon);
    }

    var fileName = document.createElement('span');
    fileName.className = 'cc-upload-filename';
    fileName.textContent = fileInfo.filename;
    previewCard.appendChild(fileName);

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'cc-btn-sm cc-upload-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', function() {
      var fieldId = container.dataset.uploadField;
      delete state.uploadedFiles[fieldId];
      if (dropZone) dropZone.style.display = '';
      previewEl.style.display = 'none';
      // Reset file input
      var fileInput = dropZone.querySelector('input[type="file"]');
      if (fileInput) fileInput.value = '';
    });
    previewCard.appendChild(removeBtn);

    previewEl.appendChild(previewCard);
  }

  function showFieldError(container, message) {
    var existing = container.querySelector('.cc-field-error');
    if (existing) existing.remove();

    var errDiv = document.createElement('div');
    errDiv.className = 'cc-field-error';
    errDiv.textContent = message;
    container.appendChild(errDiv);

    setTimeout(function() { errDiv.remove(); }, 5000);
  }

  // ─── Render Step ─────────────────────────────────────────────
  function renderStep() {
    var content = $el('cc-intake-step-content');
    var titleEl = $el('cc-intake-step-title');
    var prevBtn = $el('cc-intake-prev-btn');
    var nextBtn = $el('cc-intake-next-btn');
    if (!content) return;

    content.innerHTML = '';

    if (isReviewStep()) {
      // Render review
      if (titleEl) titleEl.textContent = 'Review & Submit';
      renderReview(content);
      if (nextBtn) {
        nextBtn.textContent = 'Submit';
        nextBtn.className = 'cc-btn cc-btn-primary cc-btn-submit';
        nextBtn.disabled = false;
      }
    } else {
      var item = getCurrentStepItem();
      if (!item) return;

      // Title
      if (titleEl) titleEl.textContent = item.step.title || '';

      // Video
      if (item.step.video) {
        content.appendChild(renderVideo(item.step.video));
      }

      // Description (step-level)
      if (item.step.description) {
        var desc = document.createElement('p');
        desc.className = 'cc-step-intro';
        desc.textContent = item.step.description;
        content.appendChild(desc);
      }

      // Fields
      (item.step.fields || []).forEach(function(field) {
        var renderer = fieldRenderers[field.type];
        if (renderer) {
          content.appendChild(renderer(field));
        }
      });

      // Next button text
      if (nextBtn) {
        nextBtn.textContent = 'Next \u2192';
        nextBtn.className = 'cc-btn cc-btn-primary';
        nextBtn.disabled = false;
      }
    }

    // Restore values
    restoreFieldValues();

    // Progress
    renderProgress();

    // Show/hide prev
    if (prevBtn) prevBtn.style.display = state.currentStepIndex > 0 ? '' : 'none';

    // Scroll to top
    content.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  // ─── Render Progress ─────────────────────────────────────────
  function renderProgress() {
    var bar = $el('cc-intake-progress');
    if (!bar) return;

    var total = getTotalSteps();
    var pct = total > 1 ? Math.round((state.currentStepIndex / (total - 1)) * 100) : 0;
    var label = 'Step ' + (state.currentStepIndex + 1) + ' of ' + total;

    bar.innerHTML = '<div style="background:#E5E7EB;border-radius:9999px;height:8px;overflow:hidden;">' +
      '<div style="background:#2563EB;height:100%;width:' + pct + '%;border-radius:9999px;transition:width 0.3s ease;"></div>' +
      '</div>' +
      '<div style="text-align:center;font-size:0.75rem;color:#6B7280;margin-top:0.35rem;">' + escapeHtml(label) + '</div>';
  }

  // ─── Render Review ───────────────────────────────────────────
  function renderReview(container) {
    var reviewDiv = document.createElement('div');
    reviewDiv.className = 'cc-intake-review';

    var desc = document.createElement('p');
    desc.className = 'cc-step-intro';
    desc.textContent = 'Please review your answers before submitting. Click "Back" to make changes.';
    reviewDiv.appendChild(desc);

    var currentSection = null;
    var sectionDiv = null;

    getVisibleSteps().forEach(function(item) {
      // Section header
      if (item.sectionTitle !== currentSection) {
        currentSection = item.sectionTitle;
        sectionDiv = document.createElement('div');
        sectionDiv.className = 'cc-intake-review-section';
        var sectionTitle = document.createElement('h3');
        sectionTitle.className = 'cc-intake-review-section-title';
        sectionTitle.textContent = currentSection;
        sectionDiv.appendChild(sectionTitle);
        reviewDiv.appendChild(sectionDiv);
      }

      (item.step.fields || []).forEach(function(field) {
        if (field.type === 'info') return;

        var val = state.formData[field.id];
        if (field.type === 'file_upload') {
          var subFields = field.sub_fields || [{ id: field.id, label: field.label }];
          subFields.forEach(function(sf) {
            var fileInfo = state.uploadedFiles[sf.id];
            if (fileInfo) {
              appendReviewItem(sectionDiv, sf.label || field.label, fileInfo.filename);
            }
          });
          return;
        }

        if (val === undefined || val === null || val === '') return;

        var displayVal = formatReviewValue(field, val);
        appendReviewItem(sectionDiv, field.label, displayVal);
      });
    });

    // Consent checkbox
    var consentGroup = document.createElement('div');
    consentGroup.className = 'cc-intake-field-group cc-intake-consent';
    var consentLabel = document.createElement('label');
    consentLabel.className = 'cc-intake-checkbox-item';
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('data-field', 'marketing_consent');
    var consentText = document.createElement('span');
    consentText.textContent = 'I consent to receive communications from Tabuchi Law regarding my matter.';
    consentLabel.appendChild(checkbox);
    consentLabel.appendChild(consentText);
    consentGroup.appendChild(consentLabel);
    reviewDiv.appendChild(consentGroup);

    // Honeypot field — hidden from humans, bots will fill it
    var hpWrap = document.createElement('div');
    hpWrap.setAttribute('aria-hidden', 'true');
    hpWrap.style.cssText = 'position:absolute;left:-9999px;top:-9999px;height:0;width:0;overflow:hidden;opacity:0;pointer-events:none;';
    var hpLabel = document.createElement('label');
    hpLabel.setAttribute('for', 'cc_website_url');
    hpLabel.textContent = 'Website';
    var hpInput = document.createElement('input');
    hpInput.type = 'text';
    hpInput.name = 'cc_website_url';
    hpInput.id = 'cc_website_url';
    hpInput.setAttribute('tabindex', '-1');
    hpInput.setAttribute('autocomplete', 'off');
    hpWrap.appendChild(hpLabel);
    hpWrap.appendChild(hpInput);
    reviewDiv.appendChild(hpWrap);

    container.appendChild(reviewDiv);
  }

  function appendReviewItem(container, label, value) {
    if (!container) return;
    var row = document.createElement('div');
    row.className = 'cc-intake-review-row';

    var labelEl = document.createElement('div');
    labelEl.className = 'cc-intake-review-label';
    labelEl.textContent = label;
    row.appendChild(labelEl);

    var valueEl = document.createElement('div');
    valueEl.className = 'cc-intake-review-value';
    valueEl.textContent = value;
    row.appendChild(valueEl);

    container.appendChild(row);
  }

  function formatReviewValue(field, val) {
    if (field.type === 'yes_no') {
      return val === 'yes' ? 'Yes' : val === 'no' ? 'No' : val;
    }
    if (field.type === 'multiple_choice' && field.options) {
      var match = field.options.find(function(o) { return o.value === val; });
      return match ? match.label : val;
    }
    if (field.type === 'date' && val) {
      try {
        return new Date(val + 'T00:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
      } catch (e) { return val; }
    }
    return String(val);
  }

  // ─── Auto-Save ───────────────────────────────────────────────
  async function autoSave() {
    if (state.saving || state.submitted || state.isPreview) return;
    state.saving = true;

    var statusEl = $el('cc-intake-save-status');
    if (statusEl) {
      statusEl.textContent = 'Saving...';
      statusEl.className = 'cc-intake-save-saving';
    }

    try {
      // Build partial data from auto_save_fields config
      var autoFields = (state.config.submit && state.config.submit.auto_save_fields) || [];
      var partial = {};
      autoFields.forEach(function(f) {
        partial[f] = state.formData[f] || '';
      });

      var result = await API.intake.save({
        session_id: state.sessionId || undefined,
        form_id: state.formId,
        step_number: state.currentStepIndex,
        form_data_partial: partial,
        form_data_json: JSON.stringify(state.formData)
      });

      if (result.success && result.session_id) {
        state.sessionId = result.session_id;
        try {
          sessionStorage.setItem('cc_intake_session', result.session_id);
          var url = new URL(window.location);
          url.searchParams.set('session', result.session_id);
          window.history.replaceState(null, '', url.toString());
        } catch (storageErr) {
          console.warn('Intake autoSave: could not persist session locally:', storageErr);
        }
      }

      if (statusEl) {
        statusEl.textContent = 'Saved';
        statusEl.className = 'cc-intake-save-saved';
        setTimeout(function() {
          if (statusEl) { statusEl.textContent = ''; statusEl.className = ''; }
        }, 2000);
      }
    } catch (err) {
      console.error('Intake autoSave error:', err);
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = '';
        statusEl.style.cssText = 'background:#FEF2F2;border:1px solid #FECACA;color:#DC2626;padding:0.5rem 0.75rem;border-radius:6px;font-size:0.85rem;display:flex;align-items:center;gap:0.5rem;';

        var warnSpan = document.createElement('span');
        warnSpan.textContent = '\u26A0 Your progress could not be saved.';
        warnSpan.style.flex = '1';
        statusEl.appendChild(warnSpan);

        var retryBtn = document.createElement('button');
        retryBtn.textContent = 'Retry';
        retryBtn.style.cssText = 'background:#DC2626;color:white;border:none;padding:0.25rem 0.6rem;border-radius:4px;font-size:0.8rem;cursor:pointer;font-weight:600;';
        retryBtn.onclick = function() {
          statusEl.innerHTML = '';
          statusEl.style.cssText = '';
          state.saving = false;
          autoSave();
        };
        statusEl.appendChild(retryBtn);
      }
    }

    state.saving = false;
  }

  // ─── Resume Session ──────────────────────────────────────────
  async function tryResume() {
    var params = new URLSearchParams(window.location.search);
    var sessionId = params.get('session') || sessionStorage.getItem('cc_intake_session');
    if (!sessionId) return false;

    try {
      var result = await API.intake.resume(sessionId);
      if (result.success && result.form_data) {
        state.sessionId = result.session_id;

        // Restore full form data from JSON if available
        if (result.form_data_json) {
          try {
            state.formData = JSON.parse(result.form_data_json);
          } catch (e) {
            state.formData = result.form_data;
          }
        } else {
          state.formData = result.form_data;
        }

        // Restore uploaded files if available
        if (result.uploaded_files) {
          state.uploadedFiles = result.uploaded_files;
        }

        sessionStorage.setItem('cc_intake_session', result.session_id);

        // Navigate to the saved step
        if (typeof result.step_number === 'number') {
          state.currentStepIndex = result.step_number;
          state.stepHistory = [];
          for (var i = 0; i <= result.step_number; i++) {
            state.stepHistory.push(i);
          }
        }

        return true;
      }
    } catch (err) {
      sessionStorage.removeItem('cc_intake_session');
    }
    return false;
  }

  // ─── Submit ──────────────────────────────────────────────────
  async function submitForm() {
    if (state.submitting) return;
    state.submitting = true;

    var nextBtn = $el('cc-intake-next-btn');
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.textContent = 'Submitting...';
    }

    try {
      collectCurrentStepData();

      // Build final data using the config's map_to_lead
      var finalData = {};
      var mapping = (state.config.submit && state.config.submit.map_to_lead) || {};
      Object.keys(mapping).forEach(function(formField) {
        finalData[formField] = state.formData[formField] || '';
      });

      // Include all form data under the final_data_key
      var dataKey = (state.config.submit && state.config.submit.final_data_key) || state.formId;
      finalData[dataKey] = state.formData;

      var consentStatus = state.formData.marketing_consent ? 'SUBSCRIBED' : 'UNKNOWN';

      // Honeypot — read hidden field value
      var hpField = document.getElementById('cc_website_url');
      var hpVal = hpField ? hpField.value : '';

      var result;
      if (state.isDynamic) {
        // Dynamic forms use CC-32 submit handler
        result = await API.forms.submitDynamic({
          session_id: state.sessionId,
          form_id: state.formId,
          final_form_data: finalData,
          uploaded_files: Object.keys(state.uploadedFiles).length > 0 ? state.uploadedFiles : undefined,
          consent_status: consentStatus,
          _hp: hpVal
        });
      } else {
        // Static forms use CC-02 intake submit
        result = await API.intake.submit({
          session_id: state.sessionId,
          form_id: state.formId,
          final_form_data: finalData,
          uploaded_files: Object.keys(state.uploadedFiles).length > 0 ? state.uploadedFiles : undefined,
          consent_status: consentStatus,
          _hp: hpVal
        });
      }

      if (result.success) {
        state.submitted = true;
        sessionStorage.removeItem('cc_intake_session');
        renderThankYou();
      } else {
        showFormError(result.error || 'Submission failed. Please try again.');
        if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = 'Submit'; }
      }
    } catch (err) {
      showFormError(err.error || 'Network error. Please check your connection and try again.');
      if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = 'Submit'; }
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
      content.innerHTML = '';
      var wrapper = document.createElement('div');
      wrapper.className = 'cc-thank-you';

      var icon = document.createElement('div');
      icon.className = 'cc-thank-you-icon';
      icon.textContent = '\u2713';
      wrapper.appendChild(icon);

      var h2 = document.createElement('h2');
      h2.textContent = state.config.submit_message || 'Your intake form has been submitted successfully.';
      wrapper.appendChild(h2);

      var p1 = document.createElement('p');
      p1.textContent = 'Our team will review your information and contact you within one business day to schedule your consultation.';
      wrapper.appendChild(p1);

      var p2 = document.createElement('p');
      p2.innerHTML = 'If you have any urgent questions, please call us at <strong>(905) 595-2225</strong>.';
      wrapper.appendChild(p2);

      var link = document.createElement('a');
      link.href = 'https://tabuchilaw.com';
      link.className = 'cc-btn cc-btn-primary';
      link.textContent = 'Return to tabuchilaw.com';
      wrapper.appendChild(link);

      content.appendChild(wrapper);
    }
  }

  function showFormError(message) {
    var content = $el('cc-intake-step-content');
    if (!content) return;

    var existing = content.querySelector('.cc-form-error');
    if (existing) existing.remove();

    var errorDiv = document.createElement('div');
    errorDiv.className = 'cc-form-error cc-error';
    errorDiv.textContent = message;
    content.insertBefore(errorDiv, content.firstChild);
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });

    setTimeout(function() { errorDiv.remove(); }, 8000);
  }

  // ─── Initialize ──────────────────────────────────────────────
  async function init() {
    // Determine form ID from URL param, default to 'uepp'
    var params = new URLSearchParams(window.location.search);
    state.formId = params.get('form') || 'uepp';
    state.isPreview = params.get('preview') === '1';

    // 1. Try local static config first (backward compatible)
    var configs = window.IntakeFormConfigs || {};
    state.config = configs[state.formId];

    // 2. If not found locally, fetch from API (dynamic form)
    if (!state.config && API.forms) {
      try {
        var titleEl = $el('cc-intake-step-title');
        if (titleEl) titleEl.textContent = 'Loading form...';
        var result = await API.forms.getPublic(state.formId);
        if (result && result.success && result.config) {
          state.config = result.config;
          state.isDynamic = true;
        }
      } catch (err) {
        // Fall through to error display below
      }
    }

    if (!state.config) {
      var content = $el('cc-intake-step-content');
      if (content) {
        content.innerHTML = '';
        var err = document.createElement('div');
        err.className = 'cc-error';
        err.textContent = 'Form configuration not found. Please check the URL and try again.';
        content.appendChild(err);
      }
      return;
    }

    // Apply branding if configured
    var formRoot = $el('cc-intake-form');
    if (formRoot && state.config.branding) {
      if (state.config.branding.accent_color) {
        formRoot.style.setProperty('--cc-form-brand-color', state.config.branding.accent_color);
      }
      formRoot.classList.add('cc-form-branded');
    }

    // Preview mode banner
    if (state.isPreview) {
      var formContainer = $el('cc-intake-form');
      if (formContainer) {
        var banner = document.createElement('div');
        banner.className = 'cc-preview-banner';
        banner.textContent = 'Preview Mode \u2014 Submissions are disabled';
        formContainer.insertBefore(banner, formContainer.firstChild);
      }
    }

    // Update page title
    var titleEl2 = $el('cc-intake-step-title');
    if (titleEl2) titleEl2.textContent = 'Loading...';

    // Try to resume saved session (skip in preview mode)
    if (!state.isPreview) {
      await tryResume();
    }

    // Bind nav buttons
    var prevBtn = $el('cc-intake-prev-btn');
    var nextBtn = $el('cc-intake-next-btn');

    if (prevBtn) {
      prevBtn.addEventListener('click', function() { prevStep(); });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function() {
        if (state.isPreview) return; // Disable submit in preview
        if (isReviewStep()) {
          submitForm();
        } else {
          nextStep();
        }
      });
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
