/**
 * UEPP (Unified Estate Planning Package) Intake Form Configuration
 *
 * 36 questions across 8 sections with conditional branching and YouTube videos.
 * Loaded before intake-engine.js. Registers on window.IntakeFormConfigs['uepp'].
 */

window.IntakeFormConfigs = window.IntakeFormConfigs || {};

window.IntakeFormConfigs['uepp'] = {
  id: 'uepp',
  title: 'Estate Planning Intake Form',
  practice_area: 'ESTATE_PLANNING_WILL_POA',
  service_package: 'UEPP',

  sections: [
    // ── Section 1: About You (Q1–Q8) ──────────────────────────
    {
      id: 'about_you',
      title: 'About You',
      steps: [
        {
          id: 'welcome',
          title: 'Welcome to Your Estate Planning Intake',
          description: 'This form will help us understand your estate planning needs. Your progress is saved automatically so you can return at any time.',
          fields: [
            {
              id: 'practice_area',
              type: 'multiple_choice',
              label: 'What type of estate planning do you need?',
              required: true,
              options: [
                { value: 'ESTATE_PLANNING_WILL_POA', label: 'Will and Powers of Attorney', description: 'Create or update your will and POAs' },
                { value: 'ESTATE_PLANNING_TRUST', label: 'Trusts', description: 'Henson trust, spousal trust, or other trust arrangements' },
                { value: 'ESTATE_PLANNING_FULL', label: 'Comprehensive Estate Plan', description: 'Full estate planning including will, POAs, and trusts' }
              ]
            }
          ]
        },
        {
          id: 'personal_name',
          title: 'What is your full legal name?',
          video: 'AnFiPPBAYrE',
          fields: [
            { id: 'client_name', type: 'short_text', label: 'Full Legal Name', required: true, placeholder: 'e.g. Jane Elizabeth Smith' }
          ]
        },
        {
          id: 'personal_dob',
          title: 'What is your date of birth?',
          fields: [
            { id: 'dob', type: 'date', label: 'Date of Birth', required: true }
          ]
        },
        {
          id: 'personal_email',
          title: 'What is your email address?',
          description: 'We will use this to send you important documents and updates about your estate plan.',
          fields: [
            { id: 'client_email', type: 'email', label: 'Email Address', required: true, placeholder: 'email@example.com' }
          ]
        },
        {
          id: 'personal_phone',
          title: 'What is your phone number?',
          fields: [
            { id: 'client_phone', type: 'phone', label: 'Phone Number', required: true, placeholder: '(416) 555-0123' }
          ]
        },
        {
          id: 'personal_address',
          title: 'What is your home address?',
          fields: [
            { id: 'client_address', type: 'address', label: 'Home Address', required: true }
          ]
        },
        {
          id: 'personal_occupation',
          title: 'What is your occupation?',
          fields: [
            { id: 'occupation', type: 'short_text', label: 'Occupation', placeholder: 'e.g. Teacher, Engineer, Retired' }
          ]
        }
      ]
    },

    // ── Section 2: Marital Status (Q9–Q10) ────────────────────
    {
      id: 'marital',
      title: 'Marital Status',
      steps: [
        {
          id: 'marital_status',
          title: 'What is your marital status?',
          video: 'jEb395y9z4U',
          fields: [
            {
              id: 'marital_status',
              type: 'multiple_choice',
              label: 'Marital Status',
              required: true,
              options: [
                { value: 'Single', label: 'Single' },
                { value: 'Married', label: 'Married' },
                { value: 'Common Law', label: 'Common Law' },
                { value: 'Separated', label: 'Separated' },
                { value: 'Divorced', label: 'Divorced' },
                { value: 'Widowed', label: 'Widowed' }
              ]
            }
          ]
        },
        {
          id: 'spouse_info',
          title: "What is your spouse's full legal name?",
          show_if: { field: 'marital_status', op: 'in', value: ['Married', 'Common Law'] },
          fields: [
            { id: 'spouse_name', type: 'short_text', label: "Spouse's Full Legal Name", required: true, placeholder: "e.g. John Robert Smith" }
          ]
        }
      ]
    },

    // ── Section 3: Executor (Q11–Q13) ─────────────────────────
    {
      id: 'executor',
      title: 'Executor',
      steps: [
        {
          id: 'executor_chosen',
          title: 'Have you chosen an executor for your will?',
          video: 'fHXwvc6N4Aw',
          description: 'An executor is the person responsible for carrying out the instructions in your will. Watch the video to learn more about choosing an executor.',
          fields: [
            {
              id: 'executor_chosen',
              type: 'yes_no',
              label: 'Have you chosen an executor?',
              required: true
            }
          ]
        },
        {
          id: 'executor_names',
          title: 'Who would you like to name as your executor(s)?',
          video: 'fHXwvc6N4Aw',
          show_if: { field: 'executor_chosen', op: 'eq', value: 'yes' },
          fields: [
            { id: 'executor_primary', type: 'short_text', label: 'Primary Executor (Full Name)', required: true, placeholder: 'e.g. Jane Smith' },
            { id: 'executor_alternate', type: 'short_text', label: 'Alternate Executor (Full Name)', placeholder: 'e.g. John Smith (optional)' },
            { id: 'executor_relationship', type: 'short_text', label: 'Relationship to You', placeholder: 'e.g. Spouse, Sibling, Friend' }
          ]
        },
        {
          id: 'executor_importance',
          title: 'Why is choosing an executor important?',
          description: 'If you have not yet chosen an executor, that is okay. We can help you think through this decision during your consultation. An executor should be someone you trust, who is organized and responsible, and who is willing to take on the role.',
          fields: [
            {
              id: 'executor_considerations',
              type: 'long_text',
              label: 'Any thoughts or concerns about choosing an executor?',
              placeholder: 'Share any questions or concerns you have about this decision...',
              rows: 4
            }
          ]
        }
      ]
    },

    // ── Section 4: Beneficiaries (Q14–Q17) ────────────────────
    {
      id: 'beneficiaries',
      title: 'Beneficiaries',
      steps: [
        {
          id: 'who_inherits',
          title: 'Who would you like to inherit your estate?',
          description: 'Think about who you would like to receive your assets. This can include family members, friends, or organizations.',
          fields: [
            {
              id: 'beneficiaries_primary',
              type: 'long_text',
              label: 'Primary Beneficiaries',
              required: true,
              placeholder: 'e.g. My spouse Jane Smith receives everything. If she predeceases me, split equally between my children...',
              rows: 4
            }
          ]
        },
        {
          id: 'specific_gifts',
          title: 'Do you have any specific gifts you would like to make?',
          description: 'Specific gifts are particular items or amounts of money you want to leave to specific people or organizations.',
          fields: [
            {
              id: 'specific_gifts',
              type: 'long_text',
              label: 'Specific Gifts (if any)',
              placeholder: 'e.g. My antique piano to my daughter Sarah. $5,000 to my neighbour Bob Jones...',
              rows: 4
            }
          ]
        },
        {
          id: 'charity',
          title: 'Would you like to make any charitable gifts?',
          fields: [
            {
              id: 'charitable_gifts',
              type: 'long_text',
              label: 'Charitable Gifts (if any)',
              placeholder: 'e.g. 10% of my estate to the Canadian Cancer Society...',
              rows: 3
            }
          ]
        },
        {
          id: 'residual_estate',
          title: 'How should the rest of your estate be distributed?',
          description: 'The residual estate is everything that remains after specific gifts and debts are paid.',
          fields: [
            {
              id: 'residual_estate',
              type: 'long_text',
              label: 'Residual Estate Distribution',
              placeholder: 'e.g. Split equally among my three children. If any child predeceases me, their share goes to their children...',
              rows: 4
            }
          ]
        }
      ]
    },

    // ── Section 5: Children (Q18–Q22) ─────────────────────────
    {
      id: 'children',
      title: 'Children',
      steps: [
        {
          id: 'has_children',
          title: 'Do you have any children?',
          fields: [
            {
              id: 'has_children',
              type: 'yes_no',
              label: 'Do you have children?',
              required: true
            }
          ]
        },
        {
          id: 'children_names',
          title: 'Please list your children',
          show_if: { field: 'has_children', op: 'eq', value: 'yes' },
          description: 'Include all children (biological, adopted, and step-children) with their full legal names and dates of birth.',
          fields: [
            {
              id: 'children_details',
              type: 'long_text',
              label: 'Children Details',
              required: true,
              placeholder: 'Name: Sarah Smith, DOB: January 15, 1995, Relationship: Biological\nName: Michael Smith, DOB: March 22, 1998, Relationship: Biological',
              rows: 6
            }
          ]
        },
        {
          id: 'prev_marriage',
          title: 'Do you have children from a previous relationship or marriage?',
          show_if: { field: 'has_children', op: 'eq', value: 'yes' },
          fields: [
            {
              id: 'prev_marriage_children',
              type: 'yes_no',
              label: 'Children from a previous relationship?',
              required: true
            }
          ]
        },
        {
          id: 'prev_marriage_details',
          title: 'Please provide details about children from previous relationships',
          show_if: { field: 'prev_marriage_children', op: 'eq', value: 'yes' },
          fields: [
            {
              id: 'prev_marriage_children_details',
              type: 'long_text',
              label: 'Previous Relationship Children Details',
              required: true,
              placeholder: 'Name: Emma Johnson, DOB: June 10, 2001, Other parent: Mark Johnson',
              rows: 4
            }
          ]
        }
      ]
    },

    // ── Section 6: Dependents (Q23–Q24) ───────────────────────
    {
      id: 'dependents',
      title: 'Dependents',
      steps: [
        {
          id: 'has_dependents',
          title: 'Do you have any dependents other than your children?',
          description: 'This includes elderly parents, disabled family members, or anyone else who depends on you financially.',
          fields: [
            {
              id: 'has_dependents',
              type: 'yes_no',
              label: 'Do you have other dependents?',
              required: true
            }
          ]
        },
        {
          id: 'dependent_details',
          title: 'Please describe your dependents',
          show_if: { field: 'has_dependents', op: 'eq', value: 'yes' },
          fields: [
            {
              id: 'dependent_details',
              type: 'long_text',
              label: 'Dependent Details',
              required: true,
              placeholder: 'e.g. My mother, Mary Smith (age 82), lives with us and depends on me for financial support...',
              rows: 4
            }
          ]
        }
      ]
    },

    // ── Section 7: Other Information (Q25–Q33) ────────────────
    {
      id: 'other_info',
      title: 'Additional Information',
      steps: [
        {
          id: 'previous_will',
          title: 'Do you have an existing will?',
          fields: [
            {
              id: 'has_previous_will',
              type: 'yes_no',
              label: 'Do you currently have a will?',
              required: true
            },
            {
              id: 'previous_will_details',
              type: 'short_text',
              label: 'If yes, when was it made and by whom?',
              placeholder: 'e.g. Made in 2015 by Smith & Associates'
            }
          ]
        },
        {
          id: 'joint_property',
          title: 'Do you own any property jointly with another person?',
          fields: [
            {
              id: 'has_joint_property',
              type: 'yes_no',
              label: 'Joint property ownership?',
              required: true
            },
            {
              id: 'joint_property_details',
              type: 'long_text',
              label: 'If yes, please describe',
              placeholder: 'e.g. Family home at 123 Main St owned jointly with my spouse...',
              rows: 3
            }
          ]
        },
        {
          id: 'life_insurance',
          title: 'Do you have any life insurance policies?',
          fields: [
            {
              id: 'has_life_insurance',
              type: 'yes_no',
              label: 'Life insurance?',
              required: true
            },
            {
              id: 'life_insurance_details',
              type: 'long_text',
              label: 'If yes, please describe',
              placeholder: 'e.g. $500,000 term life policy with Sun Life, beneficiary is my spouse...',
              rows: 3
            }
          ]
        },
        {
          id: 'digital_assets',
          title: 'Do you have significant digital assets?',
          description: 'Digital assets include online accounts, cryptocurrency, digital photos, social media accounts, domain names, etc.',
          fields: [
            {
              id: 'has_digital_assets',
              type: 'yes_no',
              label: 'Significant digital assets?',
              required: true
            },
            {
              id: 'digital_assets_details',
              type: 'long_text',
              label: 'If yes, please describe',
              placeholder: 'e.g. Cryptocurrency holdings on Coinbase, online business income from website...',
              rows: 3
            }
          ]
        },
        {
          id: 'business_interests',
          title: 'Do you have any business interests or ownership?',
          fields: [
            {
              id: 'has_business',
              type: 'yes_no',
              label: 'Business interests?',
              required: true
            },
            {
              id: 'business_details',
              type: 'long_text',
              label: 'If yes, please describe',
              placeholder: 'e.g. 50% owner of Smith Consulting Inc., sole proprietor of a rental property business...',
              rows: 3
            }
          ]
        },
        {
          id: 'funeral_wishes',
          title: 'Do you have any funeral or burial wishes?',
          fields: [
            {
              id: 'funeral_wishes',
              type: 'long_text',
              label: 'Funeral / Burial Wishes (optional)',
              placeholder: 'e.g. I would like to be cremated. I have pre-paid funeral arrangements with...',
              rows: 3
            }
          ]
        },
        {
          id: 'pet_provisions',
          title: 'Do you have any pets that need to be provided for?',
          fields: [
            {
              id: 'pet_provisions',
              type: 'long_text',
              label: 'Pet Provisions (optional)',
              placeholder: 'e.g. My dog Max should go to my sister Sarah, with $5,000 set aside for his care...',
              rows: 3
            }
          ]
        },
        {
          id: 'additional_info',
          title: 'Is there anything else we should know?',
          fields: [
            {
              id: 'additional_info',
              type: 'long_text',
              label: 'Additional Information (optional)',
              placeholder: 'Share any other information relevant to your estate plan...',
              rows: 4
            }
          ]
        },
        {
          id: 'questions_for_lawyer',
          title: 'Do you have any questions for the lawyer?',
          fields: [
            {
              id: 'questions_for_lawyer',
              type: 'long_text',
              label: 'Questions for Your Lawyer (optional)',
              placeholder: 'List any questions you would like to discuss during your consultation...',
              rows: 4
            }
          ]
        }
      ]
    },

    // ── Section 8: ID Upload (Q34–Q36) ────────────────────────
    {
      id: 'id_upload',
      title: 'Identification',
      steps: [
        {
          id: 'id_doc_1',
          title: 'Please upload your first form of government ID',
          description: 'We require two forms of government-issued photo identification. Acceptable forms include: driver\'s licence, passport, health card (Ontario photo card), citizenship card, or permanent resident card.',
          fields: [
            {
              id: 'id_doc_1',
              type: 'file_upload',
              label: 'First Government ID',
              required: true,
              sub_fields: [
                { id: 'id_doc1_front', label: 'Front of ID' },
                { id: 'id_doc1_back', label: 'Back of ID' }
              ]
            }
          ]
        },
        {
          id: 'id_doc_2',
          title: 'Please upload your second form of government ID',
          description: 'This must be a different type of ID from the first one you uploaded.',
          fields: [
            {
              id: 'id_doc_2',
              type: 'file_upload',
              label: 'Second Government ID',
              required: true,
              sub_fields: [
                { id: 'id_doc2_front', label: 'Front of ID' },
                { id: 'id_doc2_back', label: 'Back of ID' }
              ]
            }
          ]
        },
        {
          id: 'final_confirm',
          title: 'Ready to submit',
          description: 'You have completed all questions. On the next step you will be able to review all your answers before submitting.',
          fields: [
            {
              id: 'confirm_info',
              type: 'info',
              text: 'Click "Next" to review your answers, then "Submit" to send your intake form to Tabuchi Law.'
            }
          ]
        }
      ]
    }
  ],

  submit: {
    auto_save_fields: ['client_name', 'client_email', 'client_phone', 'client_address', 'practice_area'],
    map_to_lead: {
      'client_name': 'Client_Name',
      'client_email': 'Client_Email',
      'client_phone': 'Client_Phone',
      'client_address': 'Client_Address',
      'practice_area': 'Practice_Area',
      'service_package': 'Service_Package'
    },
    final_data_key: 'uepp_intake'
  },

  submit_message: 'Your estate planning intake form has been submitted successfully.'
};
