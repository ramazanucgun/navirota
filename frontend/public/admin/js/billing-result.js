// frontend/public/admin/js/billing-result.js
'use strict';
const status = new URLSearchParams(location.search).get('status');
document.getElementById(status === 'success' ? 'successBox' : 'failBox').hidden = false;
