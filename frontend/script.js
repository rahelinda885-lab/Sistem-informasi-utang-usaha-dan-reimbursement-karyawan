const state = { page: 'dashboard', obligations: [], categories: [], filters: { search: '', status: 'all', from: '', to: '' }, supabaseConfig: null };
const pageNames = { dashboard: 'Dashboard', debt: 'Utang Usaha', reimbursement: 'Reimbursement', reports: 'Laporan' };
const moneyFormatter = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
const today = localDate();
const defaultSupabaseConfig = {
  url: 'https://rjqzrsgnichealdqgotm.supabase.co',
  key: 'sb_publishable_Mjor0VhWcGXzhdIBb0RGLw_2wZfPX_O'
};

document.addEventListener('DOMContentLoaded', initialize);
document.addEventListener('click', handleClick);
document.addEventListener('input', handleFilterInput);
document.addEventListener('change', handleFilterInput);

async function initialize() {
  state.supabaseConfig = defaultSupabaseConfig;
  await refreshData();
}

async function refreshData() {
  const container = document.getElementById('page-content');
  container.innerHTML = '<div class="loading-state">Memuat data Sakura Event...</div>';
  try {
    const [obligations, categories] = await Promise.all([api('/api/obligations'), api('/api/categories')]);
    state.obligations = obligations;
    state.categories = categories;
    renderPage();
  } catch (error) {
    if (isDatabaseSetupError(error)) {
      container.innerHTML = `<section class="panel setup-state"><div class="eyebrow">Penyiapan aplikasi</div><h2>Dashboard belum siap</h2><p>Struktur database belum lengkap atau belum diperbarui. Buka SQL Editor project, jalankan seluruh isi file <code>backend/schema.sql</code> untuk menerapkan tabel dan kolom fitur terbaru, lalu muat ulang dashboard.</p><button class="btn btn-secondary" data-action="refresh">Coba lagi</button></section>`;
      return;
    }
    container.innerHTML = `<div class="panel empty-state">${escapeHtml(error.message)}<br><br><button class="btn btn-secondary" data-action="refresh">Coba lagi</button></div>`;
  }
}

async function api(url, options = {}) {
  return supabaseApi(url, options);
}

function isDatabaseSetupError(error) {
  return error.code === 'PGRST205' || error.code === '42P01' || error.code === '42703' ||
    /could not find the table|schema cache|relation .+ does not exist|column .+ does not exist|database belum tersedia/i.test(error.message);
}

async function supabaseRest(resource, options = {}) {
  const response = await fetch(`${state.supabaseConfig.url}/rest/v1/${resource}`, {
    method: options.method || 'GET',
    headers: {
      apikey: state.supabaseConfig.key,
      'Content-Type': 'application/json',
      Prefer: options.prefer || (options.method === 'POST' || options.method === 'PATCH' ? 'return=representation' : 'return=minimal')
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { throw new Error('Respons Supabase tidak valid.'); }
  }
  if (!response.ok) {
    const error = new Error(data?.message || data?.details || data?.hint || `Permintaan data gagal (${response.status}).`);
    error.code = data?.code;
    throw error;
  }
  return data;
}

async function supabaseApi(url, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  if (url === '/api/categories') {
    return supabaseRest('expense_categories?select=id,name&order=name.asc');
  }
  if (url === '/api/obligations') {
    if (method === 'GET') {
      const query = 'select=*,party:parties!obligations_party_id_fkey(id,name,party_type),category:expense_categories!obligations_category_id_fkey(id,name),payments(id,payment_date,amount,method,notes,evidence_name,evidence_data)&order=transaction_date.desc,created_at.desc';
      return (await supabaseRest(`obligations?${query}`)).map(localComputedBalance);
    }
    if (method === 'POST') {
      const party = await supabaseParty(body.party_name, body.obligation_type === 'debt' ? 'supplier' : 'employee');
      const rows = await supabaseRest('obligations', { method, body: {
        party_id: party.id,
        category_id: body.category_id || null,
        obligation_type: body.obligation_type,
        transaction_date: body.transaction_date,
        due_date: body.due_date || null,
        amount: Number(body.amount),
        description: body.description || '',
        status: body.obligation_type === 'debt' ? 'approved' : 'submitted',
        invoice_name: body.invoice_name || null,
        invoice_data: body.invoice_data || null,
        receipt_name: body.receipt_name || null,
        receipt_data: body.receipt_data || null,
        rejection_reason: ''
      } });
      return localComputedBalance(rows[0]);
    }
  }
  const match = url.match(/^\/api\/obligations\/([^/]+)(?:\/(payments|status))?$/);
  if (!match) throw new Error('Endpoint tidak ditemukan.');
  const [, id, action] = match;
  const row = state.obligations.find(item => item.id === id);
  if (!row) throw new Error('Data kewajiban tidak ditemukan.');
  if (method === 'PATCH' && !action) {
    const party = await supabaseParty(body.party_name, row.obligation_type === 'debt' ? 'supplier' : 'employee');
    const rows = await supabaseRest(`obligations?id=eq.${encodeURIComponent(id)}`, { method, body: {
      party_id: party.id,
      category_id: body.category_id || null,
      transaction_date: body.transaction_date,
      due_date: body.due_date || null,
      amount: Number(body.amount),
      description: body.description || '',
      invoice_name: body.invoice_name || row.invoice_name || null,
      invoice_data: body.invoice_data || row.invoice_data || null,
      receipt_name: body.receipt_name || row.receipt_name || null,
      receipt_data: body.receipt_data || row.receipt_data || null,
      updated_at: new Date().toISOString()
    } });
    return localComputedBalance(rows[0]);
  }
  if (method === 'DELETE' && !action) {
    await supabaseRest(`obligations?id=eq.${encodeURIComponent(id)}`, { method, prefer: 'return=minimal' });
    return { ok: true };
  }
  if (method === 'PATCH' && action === 'status') {
    if (!['submitted', 'approved', 'rejected'].includes(body.status)) throw new Error('Status reimbursement tidak valid.');
    if (row.status !== 'submitted' || body.status === 'submitted') throw new Error('Hanya pengajuan yang masih menunggu dapat disetujui atau ditolak.');
    if (body.status === 'rejected' && !String(body.rejection_reason || '').trim()) throw new Error('Alasan penolakan wajib diisi.');
    const rows = await supabaseRest(`obligations?id=eq.${encodeURIComponent(id)}`, { method, body: { status: body.status, rejection_reason: body.status === 'rejected' ? body.rejection_reason.trim() : '', updated_at: new Date().toISOString() } });
    return localComputedBalance(rows[0]);
  }
  if (method === 'POST' && action === 'payments') {
    const computed = localComputedBalance(row);
    if (row.obligation_type === 'reimbursement' && row.status !== 'approved') throw new Error('Setujui reimbursement sebelum mencatat pembayaran.');
    if (Number(body.amount) > computed.remaining) throw new Error('Nominal pembayaran melebihi sisa kewajiban.');
    const rows = await supabaseRest('payments', { method, body: { obligation_id: id, payment_date: body.payment_date, amount: Number(body.amount), method: body.method, notes: body.notes || '', evidence_name: body.evidence_name || null, evidence_data: body.evidence_data || null } });
    return rows[0];
  }
  throw new Error('Permintaan Supabase tidak didukung.');
}

async function supabaseParty(name, type) {
  const query = new URLSearchParams({ select: 'id,name,party_type', name: `eq.${name.trim()}`, party_type: `eq.${type}`, limit: '1' });
  const found = await supabaseRest(`parties?${query}`);
  if (found[0]) return found[0];
  const rows = await supabaseRest('parties', { method: 'POST', body: { name: name.trim(), party_type: type } });
  return rows[0];
}

function localComputedBalance(row) {
  const paid = (row.payments || []).reduce((total, payment) => total + Number(payment.amount), 0);
  const rejected = row.obligation_type === 'reimbursement' && row.status === 'rejected';
  return { ...row, paid_amount: paid, remaining: rejected ? 0 : Math.max(0, Number(row.amount) - paid), payment_status: paid >= Number(row.amount) ? 'paid' : paid > 0 ? 'partial' : 'unpaid' };
}

function handleClick(event) {
  const nav = event.target.closest('[data-page]');
  if (nav) {
    state.page = nav.dataset.page;
    state.filters = { search: '', status: 'all', from: '', to: '' };
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === state.page));
    renderPage();
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const id = action.dataset.id;
  switch (action.dataset.action) {
    case 'refresh': refreshData(); break;
    case 'add-debt': openObligationForm('debt'); break;
    case 'add-reimbursement': openObligationForm('reimbursement'); break;
    case 'edit': openObligationForm(getObligation(id).obligation_type, getObligation(id)); break;
    case 'detail': openDetail(getObligation(id)); break;
    case 'delete': deleteObligation(id); break;
    case 'payment': openPaymentForm(getObligation(id)); break;
    case 'approve': updateApproval(id, 'approved'); break;
    case 'submit': updateApproval(id, 'submitted'); break;
    case 'reject': updateApproval(id, 'rejected'); break;
    case 'quick-filter':
      state.filters.status = action.dataset.status;
      renderPage();
      break;
    case 'dashboard-detail': openDetail(getObligation(id)); break;
    case 'employee-history': openEmployeeHistory(action.dataset.partyId, action.dataset.partyName); break;
    case 'report-excel': exportReport(); break;
    case 'report-print': window.print(); break;
    case 'clear-report-filter': state.filters.from = ''; state.filters.to = ''; renderPage(); break;
    case 'close-modal': closeModal(); break;
  }
}

function handleFilterInput(event) {
  const target = event.target;
  if (target.matches('[data-filter]')) {
    state.filters[target.dataset.filter] = target.value;
    if (state.page === 'reports' || state.page === 'dashboard' && target.dataset.filter === 'dashboardMonths') renderPage();
    else updateTableRows();
  }
}

function renderPage() {
  document.getElementById('breadcrumb-current').textContent = pageNames[state.page];
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === state.page));
  const root = document.getElementById('page-content');
  if (state.page === 'dashboard') root.innerHTML = renderDashboard();
  if (state.page === 'debt') root.innerHTML = renderListPage('debt');
  if (state.page === 'reimbursement') root.innerHTML = renderListPage('reimbursement');
  if (state.page === 'reports') root.innerHTML = renderReports();
}

function renderDashboard() {
  const rows = state.obligations;
  const debts = rows.filter(row => row.obligation_type === 'debt');
  const reimbursements = rows.filter(row => row.obligation_type === 'reimbursement');
  const totalDebt = sum(debts, row => row.amount);
  const totalReimbursement = sum(reimbursements, row => row.amount);
  const unpaidDebt = sum(debts, row => row.remaining);
  const unpaidReimbursement = sum(reimbursements, row => row.remaining);
  const unpaid = sum(rows, row => row.remaining);
  const paid = sum(rows, row => row.paid_amount);
  const paymentProgress = totalDebt + totalReimbursement > 0
    ? Math.min(100, Math.round(paid / (totalDebt + totalReimbursement) * 100))
    : 0;
  const dueSoon = debts.filter(row => row.remaining > 0 && dueState(row).kind !== 'normal').sort((a, b) => a.due_date.localeCompare(b.due_date));
  const pending = reimbursements.filter(row => row.status === 'submitted');
  const months = monthlyTrend(rows, Number(state.filters.dashboardMonths) || 6);
  const hasTrendData = months.some(month => month.debt || month.reimbursement || month.payments);
  const chartMax = Math.max(1, ...months.flatMap(month => [month.debt, month.reimbursement, month.payments]));
  const actionItems = [
    ...dueSoon.map(row => ({ row, label: dueState(row).label, urgent: dueState(row).kind === 'late' })),
    ...pending.map(row => ({ row, label: 'Menunggu persetujuan', urgent: false }))
  ].sort((a,b) => Number(b.urgent) - Number(a.urgent)).slice(0, 8);
  const latest = [...rows].sort((a, b) => `${b.transaction_date}${b.created_at}`.localeCompare(`${a.transaction_date}${a.created_at}`)).slice(0, 6);
  return `<section class="dashboard-hero">
      <div class="hero-copy"><span class="hero-kicker"><span class="hero-kicker-dot"></span>RUANG KEUANGAN · SAKURA EVENT</span>
        <h1>Semua kewajiban,<br><span>dalam kendali.</span></h1>
        <p>Pantau utang usaha dan reimbursement dalam satu ruang kerja yang rapi.</p>
        <div class="hero-actions"><button class="btn btn-hero-light" data-action="add-debt"><span>＋</span> Catat utang</button><button class="btn btn-hero-ghost" data-action="add-reimbursement"><span>＋</span> Reimbursement</button></div>
      </div>
      <div class="hero-side">${illustration('dashboard')}</div>
    </section>
    <section class="summary-grid">
      ${summaryCard('Total utang usaha', money(totalDebt), `${percentage(unpaidDebt, totalDebt)}% belum dibayar · ${money(unpaidDebt)}`, '↗', 'pink')}
      ${summaryCard('Total reimbursement', money(totalReimbursement), `${percentage(unpaidReimbursement, totalReimbursement)}% belum dibayar · ${money(unpaidReimbursement)}`, '◉', 'blue')}
      ${summaryCard('Belum dibayar', money(unpaid), `${rows.filter(row => row.remaining > 0).length} kewajiban masih terbuka`, '◷', 'orange')}
      ${summaryCard('Sudah dibayar', money(paid), 'Akumulasi pembayaran tercatat', '✓', 'green')}
    </section>
    <section class="panel trend-panel"><div class="panel-header"><div><h2 class="panel-title">Tren kewajiban & pembayaran</h2><p class="panel-subtitle">Nilai transaksi dan pembayaran aktual per bulan</p></div><select class="field-control trend-range" data-filter="dashboardMonths"><option value="6" ${(Number(state.filters.dashboardMonths) || 6) === 6 ? 'selected' : ''}>6 bulan</option><option value="12" ${Number(state.filters.dashboardMonths) === 12 ? 'selected' : ''}>12 bulan</option></select></div>
      ${hasTrendData ? `<div class="trend-legend"><span><i class="legend-debt"></i>Utang</span><span><i class="legend-reimbursement"></i>Reimbursement</span><span><i class="legend-payments"></i>Pembayaran</span></div><div class="trend-plot-wrap"><div class="trend-y-axis"><span>${compactMoney(chartMax)}</span><span>${compactMoney(chartMax / 2)}</span><span>Rp 0</span></div><div class="trend-plot"><div class="trend-grid-lines"><i></i><i></i><i></i></div><svg class="trend-svg" viewBox="0 0 720 180" preserveAspectRatio="none" role="img" aria-label="Grafik bulanan utang, reimbursement, dan pembayaran">${trendSvg(months, chartMax)}</svg><div class="trend-labels" style="grid-template-columns:repeat(${months.length},minmax(0,1fr))">${months.map(month => `<span>${escapeHtml(month.label)}</span>`).join('')}</div></div></div>` : `<div class="trend-empty"><div class="trend-empty-copy">${illustration('empty-trend')}<strong>Belum ada data transaksi</strong><span>Grafik akan muncul setelah transaksi atau pembayaran dicatat.</span><div class="trend-empty-actions"><button class="btn btn-primary btn-small" data-action="add-debt">＋ Catat utang</button><button class="btn btn-secondary btn-small" data-action="add-reimbursement">＋ Catat reimbursement</button></div></div></div>`}
    </section>
    <section class="dashboard-grid">
      <div class="panel dashboard-latest"><div class="panel-header"><div><h2 class="panel-title">Transaksi terbaru</h2><p class="panel-subtitle">Catatan kewajiban yang baru ditambahkan</p></div><button class="link-button" data-page="debt">Lihat semua →</button></div>
        ${latest.length ? `<div class="table-wrap"><table><thead><tr><th>Supplier / Karyawan</th><th>Jenis</th><th>Tanggal</th><th>Nominal</th><th>Status</th></tr></thead><tbody>${latest.map(row => `<tr class="clickable-row" data-action="dashboard-detail" data-id="${row.id}"><td><span class="party-cell">${escapeHtml(row.party?.name || '—')}</span><span class="cell-note">${escapeHtml(row.description || row.category?.name || 'Tanpa keterangan')}</span></td><td>${typeLabel(row.obligation_type)}</td><td>${formatDate(row.transaction_date)}</td><td class="money">${money(row.amount)}</td><td>${statusBadge(row)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="dashboard-empty">${illustration('empty-debt')}<strong>Belum ada transaksi yang dicatat</strong><span>Catat transaksi pertama agar kewajiban mudah dipantau.</span><button class="btn btn-primary btn-small" data-action="add-debt">＋ Catat transaksi pertama</button></div>`}
      </div>
      <div class="panel dashboard-actions"><div class="panel-header"><div><h2 class="panel-title">Pekerjaan perlu tindakan</h2><p class="panel-subtitle">Jatuh tempo dan pengajuan yang menunggu</p></div><span class="badge ${actionItems.length ? 'badge-due-soon' : 'badge-paid'}">${actionItems.length} tugas</span></div>
        ${actionItems.length ? `<div class="reminder-list">${actionItems.map(({row,label,urgent}) => `<button class="reminder-item reminder-action" data-action="dashboard-detail" data-id="${row.id}"><span class="reminder-dot ${urgent ? 'late' : ''}"></span><span class="reminder-copy"><strong>${escapeHtml(row.party?.name || '—')}</strong><small>${label} · ${row.obligation_type === 'debt' ? formatDate(row.due_date) : formatDate(row.transaction_date)}</small></span><span class="reminder-amount">${money(row.remaining)}</span></button>`).join('')}</div>` : `<div class="dashboard-empty task-empty">${illustration('empty-tasks')}<strong>Tidak ada pekerjaan mendesak</strong><span>Semua kewajiban dan pengajuan sudah tertangani.</span></div>`}
      </div>
    </section>`;
}

function monthlyTrend(rows, count) {
  const now = new Date();
  const months = Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - count + index + 1, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return { key, label: new Intl.DateTimeFormat('id-ID', count > 6 ? { month: 'short', year: '2-digit' } : { month: 'short' }).format(date), debt: 0, reimbursement: 0, payments: 0 };
  });
  const byMonth = new Map(months.map(month => [month.key, month]));
  rows.forEach(row => {
    const month = byMonth.get(String(row.transaction_date || '').slice(0, 7));
    if (month) month[row.obligation_type === 'debt' ? 'debt' : 'reimbursement'] += Number(row.amount);
    (row.payments || []).forEach(payment => {
      const paymentMonth = byMonth.get(String(payment.payment_date || '').slice(0, 7));
      if (paymentMonth) paymentMonth.payments += Number(payment.amount);
    });
  });
  return months;
}

function compactMoney(value) {
  const amount = Number(value) || 0;
  if (amount >= 1000000000) return `Rp ${(amount / 1000000000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
  if (amount >= 1000000) return `Rp ${(amount / 1000000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (amount >= 1000) return `Rp ${(amount / 1000).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return money(amount);
}

function trendSvg(months, maximum) {
  const series = [
    { key: 'debt', color: '#c65373' },
    { key: 'reimbursement', color: '#8b6db3' },
    { key: 'payments', color: '#4f9a80' }
  ];
  const x = index => months.length === 1 ? 360 : 24 + index * 672 / (months.length - 1);
  const y = value => 154 - Math.min(1, value / maximum) * 136;
  return `${series.map(({key,color}) => {
    const points = months.map((month,index) => `${x(index)},${y(month[key])}`);
    const line = `<polyline class="trend-line ${key}" points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    const dots = months.map((month,index) => `<circle cx="${x(index)}" cy="${y(month[key])}" r="4" fill="#fff" stroke="${color}" stroke-width="2"><title>${escapeHtml(month.label)} · ${key === 'debt' ? 'Utang' : key === 'reimbursement' ? 'Reimbursement' : 'Pembayaran'}: ${money(month[key])}</title></circle>`).join('');
    return line + dots;
  }).join('')}${months.map((month,index) => `<rect class="trend-hit" x="${Math.max(0,x(index)-28)}" y="0" width="56" height="174"><title>${escapeHtml(month.label)} — Utang ${money(month.debt)}, reimbursement ${money(month.reimbursement)}, pembayaran ${money(month.payments)}</title></rect>`).join('')}`;
}

function balanceAtDate(row, date) {
  const paid = (row.payments || []).filter(payment => payment.payment_date <= date).reduce((total, payment) => total + Number(payment.amount), 0);
  const rejected = row.obligation_type === 'reimbursement' && row.status === 'rejected';
  return { ...row, paid_amount: paid, remaining: rejected ? 0 : Math.max(0, Number(row.amount) - paid), payment_status: paid >= Number(row.amount) ? 'paid' : paid > 0 ? 'partial' : 'unpaid' };
}

function summarizeByParty(rows, getTotal, getPaid, getOpen = row => Number(getTotal(row)) - Number(getPaid(row))) {
  const summary = new Map();
  rows.forEach(row => {
    const key = row.party?.id || row.party?.name || 'unknown';
    const item = summary.get(key) || { id: row.party?.id || '', name: row.party?.name || '—', count: 0, total: 0, paid: 0, open: 0 };
    item.count += 1;
    item.total += Number(getTotal(row) || 0);
    item.paid += Number(getPaid(row) || 0);
    item.open += Math.max(0, Number(getOpen(row) || 0));
    summary.set(key, item);
  });
  return [...summary.values()].sort((a,b) => b.open - a.open);
}

function renderPartyReport(title, partyLabel, rows, employeeHistory = false) {
  return `<section class="panel"><div class="panel-header"><div><h2 class="panel-title">${title}</h2><p class="panel-subtitle">Berdasarkan transaksi dalam periode terpilih</p></div></div><div class="table-wrap"><table><thead><tr><th>${partyLabel}</th><th>Transaksi</th><th>Total kewajiban</th><th>Dibayar</th><th>Terbuka</th></tr></thead><tbody>${rows.length ? rows.map(row => `<tr><td class="party-cell">${employeeHistory ? `<button class="link-button" data-action="employee-history" data-party-id="${escapeAttribute(row.id)}" data-party-name="${escapeAttribute(row.name)}">${escapeHtml(row.name)} →</button>` : escapeHtml(row.name)}</td><td>${row.count}</td><td>${money(row.total)}</td><td>${money(row.paid)}</td><td class="money">${money(row.open)}</td></tr>`).join('') : '<tr><td colspan="5" class="table-empty">Belum ada transaksi pada periode ini.</td></tr>'}</tbody></table></div></section>`;
}

function openEmployeeHistory(partyId, partyName) {
  const rows = state.obligations.filter(row => row.obligation_type === 'reimbursement' && (partyId ? row.party?.id === partyId : row.party?.name === partyName)).sort((a,b) => b.transaction_date.localeCompare(a.transaction_date));
  const paid = sum(rows, row => row.paid_amount);
  const requested = sum(rows, row => row.amount);
  const open = sum(rows, row => row.remaining);
  showModal(`<div class="modal-header"><div><h2>Riwayat reimbursement karyawan</h2><p>${escapeHtml(partyName)} · ${rows.length} pengajuan</p></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
    <div class="modal-body"><div class="report-cards">${summaryCard('Total diajukan', money(requested), `${rows.length} pengajuan`, '◉', 'blue')}${summaryCard('Telah dibayar', money(paid), 'Akumulasi pembayaran', '✓', 'green')}${summaryCard('Saldo terbuka', money(open), 'Belum dibayar', '◷', 'orange')}</div>
      <div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Diajukan</th><th>Dibayar</th><th>Sisa</th><th>Status</th><th></th></tr></thead><tbody>${rows.length ? rows.map(row => `<tr><td>${formatDate(row.transaction_date)}</td><td>${escapeHtml(row.category?.name || '—')}</td><td>${money(row.amount)}</td><td>${money(row.paid_amount)}</td><td>${money(row.remaining)}</td><td>${statusBadge(row)}</td><td><button class="btn btn-secondary btn-small" data-action="detail" data-id="${row.id}">Detail</button></td></tr>`).join('') : '<tr><td colspan="7" class="table-empty">Belum ada pengajuan reimbursement.</td></tr>'}</tbody></table></div></div>
    <div class="modal-footer"><button class="btn btn-secondary" data-action="close-modal">Tutup</button></div>`, true);
}

function renderListPage(type) {
  const isDebt = type === 'debt';
  const title = isDebt ? 'Utang Usaha' : 'Reimbursement';
  const subset = state.obligations.filter(row => row.obligation_type === type);
  const renderedRows = renderObligationRows(subset, type);
  const visibleCount = renderedRows.includes('class="table-empty"') ? 0 : (renderedRows.match(/<tr>/g) || []).length;
  const statuses = isDebt ? [['all', 'Semua status'], ['unpaid', 'Belum dibayar'], ['partial', 'Dibayar sebagian'], ['paid', 'Sudah dibayar'], ['overdue', 'Lewat jatuh tempo']] : [['all', 'Semua status'], ['submitted', 'Diajukan'], ['approved', 'Disetujui'], ['rejected', 'Ditolak'], ['unpaid', 'Belum dibayar'], ['partial', 'Dibayar sebagian'], ['paid', 'Dibayar']];
  return `<div class="page-heading"><div><div class="eyebrow">Pencatatan kewajiban</div><h1>${title}</h1><p class="page-subtitle">${isDebt ? 'Kelola tagihan supplier dan pantau tanggal jatuh temponya.' : 'Kelola pengajuan biaya karyawan dari pengajuan hingga pembayaran.'}</p></div>${illustration(isDebt ? 'debt' : 'reimbursement')}<button class="btn btn-primary" data-action="${isDebt ? 'add-debt' : 'add-reimbursement'}">＋ Tambah ${isDebt ? 'Utang' : 'Reimbursement'}</button></div>
    <section class="summary-grid">
      ${summaryCard(isDebt ? 'Total utang' : 'Total pengajuan', money(sum(subset, row => row.amount)), `${subset.length} transaksi`, isDebt ? '↗' : '◉', isDebt ? 'pink' : 'blue')}
      ${summaryCard('Belum dibayar', money(sum(subset, row => row.remaining)), `${subset.filter(row => row.remaining > 0).length} transaksi terbuka`, '◷', 'orange')}
      ${summaryCard('Sudah dibayar', money(sum(subset, row => row.paid_amount)), 'Total pembayaran tercatat', '✓', 'green')}
      ${summaryCard(isDebt ? 'Lewat jatuh tempo' : 'Menunggu persetujuan', isDebt ? `${subset.filter(row => row.remaining > 0 && dueState(row).kind === 'late').length} transaksi` : `${subset.filter(row => row.status === 'submitted').length} pengajuan`, isDebt ? 'Perlu segera ditindaklanjuti' : 'Perlu ditinjau admin', '!', 'orange')}
    </section>
    ${isDebt ? renderDebtAging(subset) : ''}
    <section class="panel list-panel"><div class="panel-header"><div><h2 class="panel-title">Daftar ${title.toLowerCase()}</h2><p class="panel-subtitle">Data tersimpan dan diperbarui secara langsung</p></div></div>
      <div class="quick-filters">${(isDebt ? [['all','Semua'],['unpaid','Belum dibayar'],['paid','Sudah dibayar'],['overdue','Jatuh tempo']] : [['all','Semua'],['submitted','Diajukan'],['approved','Disetujui'],['rejected','Ditolak'],['paid','Dibayar']]).map(([status,label]) => `<button class="quick-filter ${state.filters.status === status ? 'active' : ''}" data-action="quick-filter" data-status="${status}">${label}</button>`).join('')}</div>
      <div class="toolbar"><label class="search-box"><span>⌕</span><input class="field-control" data-filter="search" type="search" placeholder="Cari ${isDebt ? 'supplier' : 'karyawan'}..." value="${escapeAttribute(state.filters.search)}"></label>
        <select class="field-control" data-filter="status">${statuses.map(([value, label]) => `<option value="${value}" ${state.filters.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <input class="field-control" data-filter="from" type="date" aria-label="Dari tanggal" value="${escapeAttribute(state.filters.from || '')}">
        <input class="field-control" data-filter="to" type="date" aria-label="Sampai tanggal" value="${escapeAttribute(state.filters.to || '')}">
      </div>
      <div class="table-wrap"><table><thead><tr><th>${isDebt ? 'Supplier / Vendor' : 'Karyawan'}</th><th>${isDebt ? 'Tanggal transaksi' : 'Kategori'}</th>${isDebt ? '<th>Jatuh tempo</th>' : '<th>Tanggal pengeluaran</th>'}<th>Nominal</th><th>Sudah dibayar</th><th>Sisa</th><th>Status</th><th>Aksi</th></tr></thead><tbody id="obligation-table-body">${renderedRows}</tbody></table></div>
      <div class="pagination-note"><span id="table-count">${visibleCount} transaksi</span><span>Nominal dalam Rupiah (Rp)</span></div>
    </section>`;
}

function renderDebtAging(debts) {
  const buckets = [
    { label: 'Belum jatuh tempo', matches: days => days >= 0 },
    { label: 'Terlambat 1–30 hari', matches: days => days < 0 && days >= -30 },
    { label: 'Terlambat 31–60 hari', matches: days => days < -30 && days >= -60 },
    { label: 'Terlambat >60 hari', matches: days => days < -60 }
  ];
  const open = debts.filter(row => row.remaining > 0);
  return `<section class="panel aging-panel"><div class="panel-header"><div><h2 class="panel-title">Analisis umur utang</h2><p class="panel-subtitle">Saldo terbuka dikelompokkan berdasarkan hari menuju jatuh tempo</p></div></div><div class="aging-grid">${buckets.map(bucket => {
    const rows = open.filter(row => {
      const days = Math.floor((new Date(`${row.due_date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
      return bucket.matches(days);
    });
    return `<article class="aging-item"><span>${bucket.label}</span><strong>${money(sum(rows, row => row.remaining))}</strong><small>${rows.length} transaksi</small></article>`;
  }).join('')}</div></section>`;
}

function renderObligationRows(rows, type) {
  const isDebt = type === 'debt';
  const filtered = rows.filter(row => {
    const query = (state.filters.search || '').trim().toLocaleLowerCase('id-ID');
    const name = (row.party?.name || '').toLocaleLowerCase('id-ID');
    const due = isDebt ? dueState(row).kind : '';
    const status = row.status === 'rejected' ? 'rejected' : row.payment_status === 'paid' ? 'paid' : row.payment_status === 'partial' ? 'partial' : row.status === 'submitted' ? 'submitted' : 'unpaid';
    return (!query || name.includes(query)) &&
      (state.filters.status === 'all' || (state.filters.status === 'overdue' ? due === 'late' : state.filters.status === status || ['approved','rejected','submitted'].includes(state.filters.status) && row.status === state.filters.status)) &&
      (!state.filters.from || row.transaction_date >= state.filters.from) &&
      (!state.filters.to || row.transaction_date <= state.filters.to);
  });
  if (!filtered.length) {
    const searched = Boolean((state.filters.search || '').trim());
    return `<tr><td colspan="8" class="table-empty"><div class="table-empty-art">${illustration(searched ? 'empty-search' : isDebt ? 'empty-debt' : 'empty-reimbursement')}<strong>${searched ? 'Transaksi tidak ditemukan' : isDebt ? 'Belum ada transaksi utang' : 'Belum ada pengajuan reimbursement'}</strong><span>${searched ? 'Coba kata kunci lain atau atur ulang filter.' : 'Data akan muncul di sini setelah transaksi dicatat.'}</span></div></td></tr>`;
  }
  return filtered.map(row => {
    const due = isDebt ? dueState(row) : null;
    return `<tr><td><span class="party-cell">${escapeHtml(row.party?.name || '—')}</span><span class="cell-note">${escapeHtml(row.description || (isDebt ? 'Utang usaha' : 'Pengajuan reimbursement'))}</span></td>
      <td>${isDebt ? formatDate(row.transaction_date) : escapeHtml(row.category?.name || 'Lainnya')}</td>
      <td>${isDebt ? `${formatDate(row.due_date)}<span class="due-text ${due.kind === 'late' ? 'due-late' : due.kind === 'soon' || due.kind === 'today' ? 'due-soon' : 'due-ok'}">${due.label}</span>` : formatDate(row.transaction_date)}</td>
      <td class="money">${money(row.amount)}</td><td>${money(row.paid_amount)}</td><td class="money">${money(row.remaining)}</td><td>${statusBadge(row)}</td>
      <td><div class="action-group"><button class="btn btn-secondary btn-small" data-action="detail" data-id="${row.id}" title="Lihat detail">Detail</button>
      ${!isDebt && row.status === 'submitted' ? `<button class="btn btn-secondary btn-small" data-action="approve" data-id="${row.id}">Setujui</button>` : ''}
      ${!isDebt && row.status === 'submitted' ? `<button class="btn btn-danger btn-small" data-action="reject" data-id="${row.id}">Tolak</button>` : ''}
      ${row.remaining > 0 && (isDebt || row.status === 'approved') ? `<button class="btn btn-secondary btn-small" data-action="payment" data-id="${row.id}">Bayar</button>` : ''}
      <button class="btn btn-secondary btn-small" data-action="edit" data-id="${row.id}" title="Edit">Edit</button><button class="btn btn-danger btn-small" data-action="delete" data-id="${row.id}" title="Hapus">Hapus</button></div></td></tr>`;
  }).join('');
}

function renderReports() {
  const from = state.filters.from || '';
  const to = state.filters.to || '';
  const inPeriod = state.obligations.filter(row => (!from || row.transaction_date >= from) && (!to || row.transaction_date <= to));
  const debts = inPeriod.filter(row => row.obligation_type === 'debt');
  const reimbursements = inPeriod.filter(row => row.obligation_type === 'reimbursement');
  const debtAmount = sum(debts, row => row.amount);
  const reimbursementAmount = sum(reimbursements, row => row.amount);
  const unpaidDebt = sum(debts, row => row.remaining);
  const unpaidReimbursement = sum(reimbursements, row => row.remaining);
  const snapshotDate = to || today;
  const snapshotRows = state.obligations.filter(row => row.transaction_date <= snapshotDate).map(row => balanceAtDate(row, snapshotDate));
  const snapshotOpen = snapshotRows.filter(row => row.remaining > 0);
  const supplierSummary = summarizeByParty(debts, row => row.amount, row => row.paid_amount, row => row.remaining);
  const employeeSummary = summarizeByParty(reimbursements, row => row.amount, row => row.paid_amount, row => row.remaining);
  const payments = state.obligations.flatMap(row => (row.payments || []).map(payment => ({ ...payment, obligation: row }))).filter(payment => (!from || payment.payment_date >= from) && (!to || payment.payment_date <= to)).sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  return `<div class="page-heading report-heading"><div><div class="eyebrow">Pusat laporan</div><h1>Laporan</h1><p class="page-subtitle">Ringkasan utang, reimbursement, pembayaran, dan kewajiban terbuka.</p></div>${illustration('reports')}<div class="action-group"><button class="btn btn-secondary" data-action="report-print">Cetak laporan</button><button class="btn btn-primary" data-action="report-excel">▦ Unduh Excel</button></div></div>
    <div class="report-filters"><label>Dari tanggal<input type="date" class="field-control" data-filter="from" value="${escapeAttribute(from)}"></label><label>Sampai tanggal<input type="date" class="field-control" data-filter="to" value="${escapeAttribute(to)}"></label><button class="btn btn-secondary" data-action="clear-report-filter">Atur ulang</button><span class="form-help">Dibuat ${formatDate(today)} · Periode transaksi dan pembayaran mengikuti tanggal masing-masing.</span></div>
    <div class="report-cards">${summaryCard('Utang usaha', money(debtAmount), `${percentage(unpaidDebt, debtAmount)}% belum dibayar · ${money(unpaidDebt)}`, '↗', 'pink')}
    ${summaryCard('Reimbursement', money(reimbursementAmount), `${percentage(unpaidReimbursement, reimbursementAmount)}% belum dibayar · ${money(unpaidReimbursement)}`, '◉', 'blue')}
    ${summaryCard('Pembayaran pada periode', money(payments.reduce((total, payment) => total + Number(payment.amount), 0)), `${payments.length} pembayaran tercatat`, '✓', 'green')}</div>
    <div class="report-party-grid">
      ${renderPartyReport('Utang per supplier', 'Supplier', supplierSummary)}
      ${renderPartyReport('Reimbursement per karyawan', 'Karyawan', employeeSummary, true)}
    </div>
    <section class="panel report-section"><div class="panel-header"><div><h2 class="panel-title">Laporan kewajiban</h2><p class="panel-subtitle">Utang usaha dan reimbursement berdasarkan tanggal transaksi</p></div></div>
      <div class="report-section-caption">Transaksi dicatat dalam periode; kolom sisa menunjukkan saldo terkini.</div>
      <div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Supplier / Karyawan</th><th>Kategori</th><th>Nominal</th><th>Dibayar</th><th>Sisa</th><th>Status</th></tr></thead><tbody>${inPeriod.length ? inPeriod.map(row => `<tr><td>${formatDate(row.transaction_date)}</td><td>${typeLabel(row.obligation_type)}</td><td class="party-cell">${escapeHtml(row.party?.name || '—')}</td><td>${escapeHtml(row.category?.name || '—')}</td><td class="money">${money(row.amount)}</td><td>${money(row.paid_amount)}</td><td class="money">${money(row.remaining)}</td><td>${statusBadge(row)}</td></tr>`).join('') : tableEmpty('Belum ada transaksi pada periode ini.', 'Ubah periode atau catat transaksi baru.', 'reports', 8)}</tbody></table></div></section>
    <section class="panel report-section"><div class="panel-header"><div><h2 class="panel-title">Saldo kewajiban akhir periode</h2><p class="panel-subtitle">Snapshot ${formatDate(snapshotDate)} — saldo memperhitungkan pembayaran sampai tanggal tersebut</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Jenis</th><th>Supplier / Karyawan</th><th>Nominal kewajiban</th><th>Dibayar s.d. tanggal</th><th>Saldo terbuka</th></tr></thead><tbody>${snapshotOpen.length ? snapshotOpen.map(row => `<tr><td>${typeLabel(row.obligation_type)}</td><td class="party-cell">${escapeHtml(row.party?.name || '—')}</td><td>${money(row.amount)}</td><td>${money(row.paid_amount)}</td><td class="money">${money(row.remaining)}</td></tr>`).join('') : tableEmpty('Tidak ada saldo kewajiban terbuka.', 'Snapshot periode ini sudah lunas.', 'reports', 5)}</tbody></table></div></section>
    <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Laporan pembayaran</h2><p class="panel-subtitle">Riwayat pembayaran pada periode terpilih</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Tanggal bayar</th><th>Jenis</th><th>Supplier / Karyawan</th><th>Metode</th><th>Keterangan</th><th>Nominal</th></tr></thead><tbody>${payments.length ? payments.map(payment => `<tr><td>${formatDate(payment.payment_date)}</td><td>${typeLabel(payment.obligation.obligation_type)}</td><td class="party-cell">${escapeHtml(payment.obligation.party?.name || '—')}</td><td>${escapeHtml(payment.method)}</td><td>${escapeHtml(payment.notes || '—')}</td><td class="money">${money(payment.amount)}</td></tr>`).join('') : tableEmpty('Belum ada pembayaran pada periode ini.', 'Pembayaran yang dicatat akan tampil di sini.', 'reports', 6)}</tbody></table></div></section>`;
}

function openObligationForm(type, row) {
  const editing = Boolean(row);
  const isDebt = type === 'debt';
  const existingDocumentName = isDebt ? row?.invoice_name : row?.receipt_name;
  const existingDocumentData = isDebt ? row?.invoice_data : row?.receipt_data;
  const documentInputName = isDebt ? 'invoice_file' : 'receipt_file';
  const documentLabel = isDebt ? 'Faktur / dokumen pendukung' : 'Bukti pengeluaran / dokumen pendukung';
  const categoryOptions = state.categories.map(category => `<option value="${category.id}" ${row?.category_id === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('');
  showModal(`<div class="modal-header"><div><h2>${editing ? 'Edit' : 'Tambah'} ${isDebt ? 'Utang Usaha' : 'Reimbursement'}</h2><p>Lengkapi data transaksi Sakura Event di bawah ini.</p></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
    <form id="obligation-form"><div class="modal-body"><div class="form-grid">
      <label class="full">${isDebt ? 'Nama supplier / vendor' : 'Nama karyawan'} <span class="required">*</span><input class="field-control" name="party_name" maxlength="120" required value="${escapeAttribute(row?.party?.name || '')}" placeholder="${isDebt ? 'Contoh: PT Sumber Acara' : 'Contoh: Andi Pratama'}"></label>
      ${!isDebt ? `<label>Kategori pengeluaran <span class="required">*</span><select class="field-control" name="category_id" required><option value="">Pilih kategori</option>${categoryOptions}</select></label>` : ''}
      ${dateInput('transaction_date', isDebt ? 'Tanggal transaksi' : 'Tanggal pengeluaran', row?.transaction_date || '')}
      ${isDebt ? dateInput('due_date', 'Tanggal jatuh tempo', row?.due_date || '') : ''}
      <label>Nominal (Rp) <span class="required">*</span><input class="field-control" type="number" name="amount" min="1" step="1" required value="${escapeAttribute(row?.amount || '')}" placeholder="Contoh: 250000"></label>
      <label class="full">${documentLabel} <span class="required">*</span><input class="field-control" type="file" name="${documentInputName}" accept=".pdf,image/png,image/jpeg,image/webp" ${existingDocumentData ? '' : 'required'}><small class="form-help">${existingDocumentName ? `Tersimpan: ${escapeHtml(existingDocumentName)} · ` : 'Dokumen wajib dilampirkan. '}PDF/JPG/PNG/WebP, maks. 3 MB.</small></label>
      <label class="full">Keterangan<textarea class="field-control" name="description" maxlength="1000" placeholder="Tambahkan detail transaksi (opsional)">${escapeHtml(row?.description || '')}</textarea></label>
    </div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-action="close-modal">Batal</button><button type="submit" class="btn btn-primary">${editing ? 'Simpan perubahan' : 'Simpan transaksi'}</button></div></form>`);
  document.getElementById('obligation-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    const invoiceFile = form.get('invoice_file');
    const receiptFile = form.get('receipt_file');
    delete payload.invoice_file;
    delete payload.receipt_file;
    const selectedDocument = isDebt ? invoiceFile : receiptFile;
    const hasExistingDocument = Boolean(existingDocumentName && existingDocumentData);
    if (!(selectedDocument instanceof File && selectedDocument.size) && !hasExistingDocument) {
      toast(`Lampirkan ${isDebt ? 'faktur atau dokumen pendukung' : 'bukti pengeluaran atau dokumen pendukung'} sebelum menyimpan transaksi.`, true);
      event.currentTarget.querySelector(`[name="${documentInputName}"]`).reportValidity();
      return;
    }
    try {
      if (invoiceFile instanceof File && invoiceFile.size) Object.assign(payload, await attachmentPayload(invoiceFile, 'invoice'));
      if (receiptFile instanceof File && receiptFile.size) Object.assign(payload, await attachmentPayload(receiptFile, 'receipt'));
    } catch (error) {
      toast(error.message, true);
      return;
    }
    const transactionDate = parseDateInput(payload.transaction_date);
    const dueDate = isDebt ? parseDateInput(payload.due_date) : null;
    if (!transactionDate || (isDebt && !dueDate)) {
      const input = formElement.querySelector(`[name="${!transactionDate ? 'transaction_date' : 'due_date'}"]`);
      input.setCustomValidity('Pilih tanggal yang valid.');
      input.reportValidity();
      return;
    }
    payload.transaction_date = transactionDate;
    if (isDebt) payload.due_date = dueDate;
    payload.obligation_type = type;
    payload.amount = Number(payload.amount);
    const submit = formElement.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api(editing ? `/api/obligations/${row.id}` : '/api/obligations', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      closeModal();
      toast(editing ? 'Perubahan transaksi berhasil disimpan.' : 'Transaksi berhasil ditambahkan.');
      await refreshData();
    } catch (error) { toast(error.message, true); submit.disabled = false; }
  });
}

function openPaymentForm(row) {
  showModal(`<div class="modal-header"><div><h2>Catat pembayaran</h2><p>${escapeHtml(row.party?.name || '')} · Sisa kewajiban ${money(row.remaining)}</p></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
    <form id="payment-form"><div class="modal-body"><div class="form-grid">
      ${dateInput('payment_date', 'Tanggal pembayaran', today)}
      <label>Nominal pembayaran (Rp) <span class="required">*</span><input class="field-control" type="number" name="amount" min="1" max="${Math.floor(row.remaining)}" step="1" required value="${Math.floor(row.remaining)}"></label>
      <label>Metode pembayaran <span class="required">*</span><select class="field-control" name="method" required><option>Transfer bank</option><option>Tunai</option><option>E-wallet</option><option>Lainnya</option></select></label>
      <label class="full">Bukti pembayaran<input class="field-control" type="file" name="evidence_file" accept=".pdf,image/png,image/jpeg,image/webp"><small class="form-help">PDF/JPG/PNG/WebP, maks. 3 MB.</small></label>
      <label class="full">Keterangan<textarea class="field-control" name="notes" maxlength="500" placeholder="Nomor referensi atau catatan (opsional)"></textarea></label>
    </div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-action="close-modal">Batal</button><button type="submit" class="btn btn-primary">Simpan pembayaran</button></div></form>`);
  document.getElementById('payment-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    const evidenceFile = form.get('evidence_file');
    delete payload.evidence_file;
    try {
      if (evidenceFile instanceof File && evidenceFile.size) Object.assign(payload, await attachmentPayload(evidenceFile, 'evidence'));
    } catch (error) {
      toast(error.message, true);
      return;
    }
    const paymentDate = parseDateInput(payload.payment_date);
    if (!paymentDate) {
      const input = formElement.querySelector('[name="payment_date"]');
      input.setCustomValidity('Pilih tanggal yang valid.');
      input.reportValidity();
      return;
    }
    payload.payment_date = paymentDate;
    payload.amount = Number(payload.amount);
    const submit = formElement.querySelector('[type="submit"]');
    if (!window.confirm(`Catat pembayaran ${money(payload.amount)} untuk ${row.party?.name || 'transaksi ini'}?`)) return;
    submit.disabled = true;
    try {
      await api(`/api/obligations/${row.id}/payments`, { method: 'POST', body: JSON.stringify(payload) });
      closeModal(); toast('Pembayaran berhasil dicatat.'); await refreshData();
    } catch (error) { toast(error.message, true); submit.disabled = false; }
  });
}

function openDetail(row) {
  const payments = row.payments || [];
  const due = row.obligation_type === 'debt' ? dueState(row) : null;
  const paymentHistory = [...payments].sort((a,b) => a.payment_date.localeCompare(b.payment_date)).reduce((history, payment) => {
    const previous = history.length ? history[history.length - 1].remainingAfter : Number(row.amount);
    history.push({ ...payment, remainingAfter: Math.max(0, previous - Number(payment.amount)) });
    return history;
  }, []);
  showModal(`<div class="modal-header"><div><h2>Detail ${row.obligation_type === 'debt' ? 'utang usaha' : 'reimbursement'}</h2><p>${escapeHtml(row.party?.name || '—')}</p></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
    <div class="modal-body"><div class="detail-grid">
      ${detailItem('Jenis transaksi', row.obligation_type === 'debt' ? 'Utang usaha' : 'Reimbursement')}
      ${detailItem(row.obligation_type === 'debt' ? 'Supplier / vendor' : 'Karyawan', escapeHtml(row.party?.name || '—'))}
      ${detailItem(row.obligation_type === 'debt' ? 'Tanggal transaksi' : 'Tanggal pengeluaran', formatDate(row.transaction_date))}
      ${detailItem('Kategori', escapeHtml(row.category?.name || '—'))}
      ${row.obligation_type === 'debt' ? detailItem('Jatuh tempo', `${formatDate(row.due_date)} · ${escapeHtml(due.label)}`) : detailItem('Status persetujuan', row.status === 'approved' ? 'Disetujui' : row.status === 'rejected' ? 'Ditolak' : 'Diajukan')}
      ${detailItem('Total kewajiban', money(row.amount))}
      ${detailItem('Sudah dibayar', money(row.paid_amount))}
      ${detailItem('Sisa kewajiban', money(row.remaining))}
      ${row.obligation_type === 'reimbursement' && row.status === 'rejected' ? detailItem('Alasan penolakan', escapeHtml(row.rejection_reason || '—')) : ''}
      <div class="detail-item detail-note"><small>Keterangan</small><strong>${escapeHtml(row.description || 'Tidak ada keterangan')}</strong></div>
    </div>
    ${row.invoice_data ? `<div class="payment-history"><h3>Dokumen transaksi</h3><a class="attachment-link" href="${escapeAttribute(row.invoice_data)}" download="${escapeAttribute(row.invoice_name || 'faktur')}">Unduh faktur · ${escapeHtml(row.invoice_name || 'Lampiran')}</a></div>` : ''}
    ${row.receipt_data ? `<div class="payment-history"><h3>Bukti pengeluaran</h3><a class="attachment-link" href="${escapeAttribute(row.receipt_data)}" download="${escapeAttribute(row.receipt_name || 'bukti-pengeluaran')}">Lihat bukti · ${escapeHtml(row.receipt_name || 'Lampiran')}</a></div>` : row.obligation_type === 'reimbursement' ? '<div class="missing-proof">Belum ada bukti pengeluaran · perlu diperiksa.</div>' : ''}
    <div class="payment-history"><h3>Riwayat pembayaran (${payments.length})</h3>${paymentHistory.length ? paymentHistory.map(payment => `<div class="history-row"><span>${formatDate(payment.payment_date)} · ${escapeHtml(payment.method)}<small class="cell-note">Sisa setelah pembayaran: ${money(payment.remainingAfter)}</small>${payment.notes ? `<small class="cell-note">${escapeHtml(payment.notes)}</small>` : ''}${payment.evidence_data ? `<a class="cell-note attachment-link" href="${escapeAttribute(payment.evidence_data)}" download="${escapeAttribute(payment.evidence_name || 'bukti-pembayaran')}">Bukti: ${escapeHtml(payment.evidence_name || 'Lampiran')}</a>` : ''}</span><strong>${money(payment.amount)}</strong></div>`).join('') : '<div class="empty-state">Belum ada pembayaran.</div>'}</div></div>
    <div class="modal-footer"><button class="btn btn-secondary" data-action="close-modal">Tutup</button>${row.obligation_type === 'reimbursement' && row.status === 'submitted' ? `<button class="btn btn-danger" data-action="reject" data-id="${row.id}">Tolak</button><button class="btn btn-primary" data-action="approve" data-id="${row.id}">Setujui pengajuan</button>` : ''}${row.remaining > 0 && (row.obligation_type === 'debt' || row.status === 'approved') ? `<button class="btn btn-primary" data-action="payment" data-id="${row.id}">Catat pembayaran</button>` : ''}</div>`, true);
}

async function updateApproval(id, status) {
  const row = getObligation(id);
  if (status === 'approved' && !window.confirm(`Setujui reimbursement ${row.party?.name || ''} sebesar ${money(row.amount)}?`)) return;
  let rejection_reason = '';
  if (status === 'rejected') {
    rejection_reason = window.prompt(`Masukkan alasan penolakan reimbursement ${row.party?.name || ''}:`, '');
    if (rejection_reason === null) return;
    if (!rejection_reason.trim()) { toast('Alasan penolakan wajib diisi.', true); return; }
  }
  try {
    await api(`/api/obligations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, rejection_reason }) });
    closeModal(); toast(status === 'approved' ? 'Reimbursement berhasil disetujui.' : status === 'rejected' ? 'Reimbursement ditolak.' : 'Status reimbursement diperbarui.'); await refreshData();
  } catch (error) { toast(error.message, true); }
}

async function deleteObligation(id) {
  const row = getObligation(id);
  if (!window.confirm(`Hapus transaksi ${row.party?.name || ''}? Riwayat pembayarannya juga akan dihapus. Tindakan ini tidak dapat dibatalkan.`)) return;
  try {
    await api(`/api/obligations/${id}`, { method: 'DELETE' });
    toast('Transaksi berhasil dihapus.');
    await refreshData();
  } catch (error) { toast(error.message, true); }
}

function updateTableRows() {
  const body = document.getElementById('obligation-table-body');
  if (!body) return;
  const type = state.page === 'debt' ? 'debt' : 'reimbursement';
  const countRows = renderObligationRows(state.obligations.filter(row => row.obligation_type === type), type);
  body.innerHTML = countRows;
  document.querySelectorAll('.quick-filter').forEach(button => button.classList.toggle('active', button.dataset.status === state.filters.status));
  const count = countRows.includes('class="table-empty"') ? 0 : (body.innerHTML.match(/<tr>/g) || []).length;
  document.getElementById('table-count').textContent = `${count} transaksi`;
}

function exportReport() {
  const from = state.filters.from || '';
  const to = state.filters.to || '';
  const rows = state.obligations.filter(row => (!from || row.transaction_date >= from) && (!to || row.transaction_date <= to));
  const payments = state.obligations.flatMap(row => (row.payments || []).map(payment => ({ ...payment, obligation: row })))
    .filter(payment => (!from || payment.payment_date >= from) && (!to || payment.payment_date <= to))
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  const debts = rows.filter(row => row.obligation_type === 'debt');
  const reimbursements = rows.filter(row => row.obligation_type === 'reimbursement');
  const snapshotDate = to || today;
  const snapshotRows = state.obligations.filter(row => row.transaction_date <= snapshotDate).map(row => balanceAtDate(row, snapshotDate));
  const suppliers = summarizeByParty(debts, row => row.amount, row => row.paid_amount, row => row.remaining);
  const employees = summarizeByParty(reimbursements, row => row.amount, row => row.paid_amount, row => row.remaining);
  const debtTotal = sum(debts, row => row.amount);
  const reimbursementTotal = sum(reimbursements, row => row.amount);
  const workbook = [
    {
      name: 'Ringkasan',
      rows: [
        [excelCell('LAPORAN KEUANGAN · SAKURA EVENT', 'title')],
        [excelCell('Periode'), excelCell(from ? formatDate(from) : 'Semua tanggal'), excelCell('s.d.'), excelCell(to ? formatDate(to) : 'Hari ini')],
        [excelCell('Tanggal dibuat'), excelCell(formatDate(today))],
        [],
        [excelCell('JENIS KEWAJIBAN', 'header'), excelCell('TOTAL (RP)', 'header'), excelCell('DIBAYAR (RP)', 'header'), excelCell('SISA (RP)', 'header'), excelCell('BELUM DIBAYAR', 'header')],
        [excelCell('Utang usaha'), excelCell(debtTotal, 'currency'), excelCell(sum(debts, row => row.paid_amount), 'currency'), excelCell(sum(debts, row => row.remaining), 'currency'), excelCell(debtTotal ? sum(debts, row => row.remaining) / debtTotal : 0, 'percent')],
        [excelCell('Reimbursement'), excelCell(reimbursementTotal, 'currency'), excelCell(sum(reimbursements, row => row.paid_amount), 'currency'), excelCell(sum(reimbursements, row => row.remaining), 'currency'), excelCell(reimbursementTotal ? sum(reimbursements, row => row.remaining) / reimbursementTotal : 0, 'percent')],
        [excelCell('TOTAL'), excelCell(sum(rows, row => row.amount), 'currency'), excelCell(sum(rows, row => row.paid_amount), 'currency'), excelCell(sum(rows, row => row.remaining), 'currency'), excelCell(sum(rows, row => row.amount) ? sum(rows, row => row.remaining) / sum(rows, row => row.amount) : 0, 'percent')],
        [excelCell('Pembayaran pada periode'), excelCell(payments.reduce((total, payment) => total + Number(payment.amount), 0), 'currency')]
      ]
    },
    {
      name: 'Per Pihak',
      rows: [
        [excelCell('RINGKASAN PER PIHAK · SAKURA EVENT', 'title')],
        [excelCell('Tanggal dibuat'), excelCell(formatDate(today)), excelCell('Periode'), excelCell(`${from ? formatDate(from) : 'Semua tanggal'} s.d. ${to ? formatDate(to) : 'Hari ini'}`)],
        ...[['SUPPLIER', suppliers], ['KARYAWAN', employees]].flatMap(([group, items]) => [
          [excelCell(group, 'header')],
          ['Pihak', 'Transaksi', 'Total kewajiban (Rp)', 'Dibayar (Rp)', 'Terbuka (Rp)'].map(value => excelCell(value, 'header')),
          ...items.map(item => [excelCell(item.name), excelCell(item.count), excelCell(item.total, 'currency'), excelCell(item.paid, 'currency'), excelCell(item.open, 'currency')])
        ])
      ]
    },
    {
      name: 'Saldo Akhir Periode',
      rows: [
        [excelCell('SALDO KEWAJIBAN AKHIR PERIODE · SAKURA EVENT', 'title')],
        [excelCell('Tanggal dibuat'), excelCell(formatDate(today)), excelCell('Snapshot per'), excelCell(formatDate(snapshotDate))],
        ['Jenis', 'Supplier / Karyawan', 'Kewajiban (Rp)', 'Dibayar s.d. tanggal (Rp)', 'Saldo terbuka (Rp)'].map(value => excelCell(value, 'header')),
        ...snapshotRows.filter(row => row.remaining > 0).map(row => [excelCell(typeLabel(row.obligation_type)), excelCell(row.party?.name || ''), excelCell(Number(row.amount), 'currency'), excelCell(Number(row.paid_amount), 'currency'), excelCell(Number(row.remaining), 'currency')])
      ]
    },
    {
      name: 'Kewajiban',
      rows: [
        [excelCell('DAFTAR KEWAJIBAN · SAKURA EVENT', 'title')],
        ['Tanggal transaksi', 'Jenis', 'Supplier / Karyawan', 'Kategori', 'Jatuh tempo', 'Nominal (Rp)', 'Dibayar (Rp)', 'Sisa (Rp)', 'Persentase belum dibayar', 'Status'].map(value => excelCell(value, 'header')),
        ...rows.map(row => [excelCell(row.transaction_date, 'date'), excelCell(typeLabel(row.obligation_type)), excelCell(row.party?.name || ''), excelCell(row.category?.name || ''), excelCell(row.due_date || '', row.due_date ? 'date' : 'text'), excelCell(Number(row.amount), 'currency'), excelCell(Number(row.paid_amount), 'currency'), excelCell(Number(row.remaining), 'currency'), excelCell(Number(row.amount) ? Number(row.remaining) / Number(row.amount) : 0, 'percent'), excelCell(readableStatus(row))])
      ]
    },
    {
      name: 'Pembayaran',
      rows: [
        [excelCell('RIWAYAT PEMBAYARAN · SAKURA EVENT', 'title')],
        ['Tanggal pembayaran', 'Jenis', 'Supplier / Karyawan', 'Metode', 'Keterangan', 'Nominal (Rp)'].map(value => excelCell(value, 'header')),
        ...payments.map(payment => [excelCell(payment.payment_date, 'date'), excelCell(typeLabel(payment.obligation.obligation_type)), excelCell(payment.obligation.party?.name || ''), excelCell(payment.method), excelCell(payment.notes || ''), excelCell(Number(payment.amount), 'currency')])
      ]
    }
  ];
  const xlsx = buildExcelWorkbook(workbook);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  link.download = `laporan-sakura-event-${today}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function excelCell(value, style = 'text') { return { value, style }; }

function buildExcelWorkbook(sheets) {
  const escapeXml = value => String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
  const styleId = { title: 1, header: 2, currency: 3, percent: 4, date: 5 };
  const columnName = index => {
    let name = '';
    for (index++; index; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + (index - 1) % 26) + name;
    return name;
  };
  const dateSerial = value => (Date.parse(`${value}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000;
  const worksheetFiles = sheets.map((sheet, sheetIndex) => {
    const rows = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => {
      if (cell == null) return '';
      const item = typeof cell === 'object' && Object.hasOwn(cell, 'value') ? cell : excelCell(cell);
      const value = item.value;
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = styleId[item.style] ? ` s="${styleId[item.style]}"` : '';
      if (item.style === 'date' && value) return `<c r="${reference}"${style}><v>${dateSerial(value)}</v></c>`;
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}"${style}><v>${value}</v></c>`;
      return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return [`xl/worksheets/sheet${sheetIndex + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><sheetData>${rows}</sheetData></worksheet>`];
  });
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0;[Red]-#,##0"/><numFmt numFmtId="165" formatCode="0.00%"/><numFmt numFmtId="166" formatCode="dd mmm yyyy"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Aptos"/><color rgb="FF302C3C"/></font><font><b/><sz val="16"/><name val="Aptos Display"/><color rgb="FF9E3F5C"/></font><font><b/><sz val="10"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF0F4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF563548"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...worksheetFiles
  ];
  return zipStore(files);
}

function zipStore(files) {
  const encoder = new TextEncoder();
  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const [filename, content] of files) {
    const name = encoder.encode(filename);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, data);

    const directory = new Uint8Array(46 + name.length);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint16(8, 0x0800, true);
    directoryView.setUint16(10, 0, true);
    directoryView.setUint16(12, dosTime, true);
    directoryView.setUint16(14, dosDate, true);
    directoryView.setUint32(16, checksum, true);
    directoryView.setUint32(20, data.length, true);
    directoryView.setUint32(24, data.length, true);
    directoryView.setUint16(28, name.length, true);
    directoryView.setUint32(42, offset, true);
    directory.set(name, 46);
    centralDirectory.push(directory);
    offset += local.length + data.length;
  }
  const directorySize = centralDirectory.reduce((total, item) => total + item.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  const parts = [...chunks, ...centralDirectory, end];
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

function showModal(content, sidePanel = false) {
  document.getElementById('modal-root').innerHTML = `<div class="modal-backdrop${sidePanel ? ' side-panel-backdrop' : ''}"><section class="modal${sidePanel ? ' detail-drawer' : ''}" role="dialog" aria-modal="true">${content}</section></div>`;
  document.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target.classList.contains('modal-backdrop')) closeModal(); });
  document.querySelectorAll('#modal-root input[name$="_date"]').forEach(input => input.addEventListener('input', () => input.setCustomValidity('')));
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
function getObligation(id) { return state.obligations.find(row => row.id === id); }

function toast(message, error = false) {
  const region = document.getElementById('toast-region');
  const item = document.createElement('div');
  item.className = `toast${error ? ' error' : ''}`;
  item.textContent = message;
  region.appendChild(item);
  setTimeout(() => item.remove(), 4000);
}

function dueState(row) {
  if (row.remaining <= 0) return { kind: 'normal', label: 'Lunas' };
  if (!row.due_date) return { kind: 'normal', label: 'Belum jatuh tempo' };
  const due = new Date(`${row.due_date}T00:00:00`);
  const current = new Date(`${today}T00:00:00`);
  const days = Math.round((due - current) / 86400000);
  if (days < 0) return { kind: 'late', label: `Lewat ${Math.abs(days)} hari` };
  if (days === 0) return { kind: 'today', label: 'Jatuh tempo hari ini' };
  if (days <= 7) return { kind: 'soon', label: `Jatuh tempo ${days} hari lagi` };
  return { kind: 'normal', label: 'Belum jatuh tempo' };
}

function statusBadge(row) {
  if (row.payment_status === 'paid') return '<span class="badge badge-paid">Dibayar</span>';
  if (row.payment_status === 'partial') return '<span class="badge badge-partial">Dibayar sebagian</span>';
  if (row.obligation_type === 'reimbursement' && row.status === 'rejected') return '<span class="badge badge-rejected">Ditolak</span>';
  if (row.obligation_type === 'reimbursement' && row.status === 'submitted') return '<span class="badge badge-submitted">Diajukan</span>';
  if (row.obligation_type === 'reimbursement' && row.status === 'approved') return '<span class="badge badge-approved">Disetujui</span>';
  const due = dueState(row);
  if (due.kind === 'late') return '<span class="badge badge-overdue">Lewat jatuh tempo</span>';
  if (due.kind === 'today') return '<span class="badge badge-due-today">Jatuh tempo hari ini</span>';
  if (due.kind === 'soon') return '<span class="badge badge-due-soon">Mendekati jatuh tempo</span>';
  return '<span class="badge badge-unpaid">Belum dibayar</span>';
}

function readableStatus(row) {
  if (row.payment_status === 'paid') return 'Dibayar';
  if (row.payment_status === 'partial') return 'Dibayar sebagian';
  if (row.obligation_type === 'reimbursement' && row.status === 'rejected') return 'Ditolak';
  if (row.obligation_type === 'reimbursement' && row.status === 'submitted') return 'Diajukan';
  if (row.obligation_type === 'reimbursement' && row.status === 'approved') return 'Disetujui';
  return dueState(row).kind === 'late' ? 'Lewat jatuh tempo' : 'Belum dibayar';
}
function summaryCard(title, value, note, icon, color) { return `<article class="summary-card"><div class="summary-top"><span>${title}</span><span class="summary-icon icon-${color}">${icon}</span></div><div class="summary-value">${value}</div><div class="summary-note">${note}</div></article>`; }
function tableEmpty(title, subtitle, kind, columns) { return `<tr><td colspan="${columns}" class="table-empty"><div class="table-empty-art">${illustration(kind)}<strong>${title}</strong><span>${subtitle}</span></div></td></tr>`; }
function detailItem(label, value) { return `<div class="detail-item"><small>${label}</small><strong>${value}</strong></div>`; }
function illustration(kind) {
  if (kind === 'dashboard') return `<svg class="hero-art" viewBox="0 0 400 260" role="img" aria-label="Ilustrasi meja kerja event organizer dengan laptop, faktur, dan bunga sakura">
    <ellipse cx="225" cy="224" rx="154" ry="15" fill="#211a2b" opacity=".2"/>
    <path d="m69 187 144-78 151 62-145 80z" fill="#e7b4c1"/><path d="m69 187 150 64v9l-150-64z" fill="#c47a8e"/><path d="m219 251 145-80v9l-145 80z" fill="#a95e77"/>
    <path d="m111 120 57-32 61 25-59 33z" fill="#443047"/><path d="m119 119 49-27 52 21-50 28z" fill="#fae6eb"/><path d="m130 118 14-8v10l-14 8z" fill="#d46d87"/><path d="m149 108 11-6v6l-11 6zm0 11 30-16 19 8-30 16z" fill="#fff9f8"/><path d="m110 120 60 26 59-33 7 4-66 37-67-29z" fill="#b76b82"/><path d="m126 128 9-5m2 9 9-5m2 9 9-5m2 9 9-5m6-11 9-5m2 9 9-5m2 9 9-5" stroke="#f7dce2" stroke-width="2" stroke-linecap="round"/>
    <path d="m125 166 82-45 95 39-83 46z" fill="#443047"/><path d="m135 164 71-39 77 32-72 39z" fill="#efccd4"/><path d="m147 162 59-32 57 24-59 32z" fill="#fff8f7"/><path d="m160 160 18-10m-13 16 29-16m-24 22 21-12" stroke="#c96c83" stroke-width="2.5" stroke-linecap="round"/>
    <path d="m158 119 38-21 54 22-38 21z" fill="#c65373"/><path d="m168 119 28-15 32 13-28 15z" fill="#fae6eb"/><path d="m176 118 12-7m-8 10 12-7" stroke="#d48396" stroke-width="2" stroke-linecap="round"/>
    <path d="m274 158 31-17 32 13-32 18z" fill="#fff9f8" stroke="#d891a2" stroke-width="2"/><path d="m282 157 18-10m-14 15 24-13" stroke="#c96c83" stroke-width="2" stroke-linecap="round"/>
    <path d="m317 133c-2-24 2-42 13-56m-12 40c-13-3-20-11-20-22m18 12c13-4 18-12 18-23" fill="none" stroke="#966075" stroke-width="3" stroke-linecap="round"/><g fill="#f3b6c4"><ellipse cx="299" cy="91" rx="6" ry="9" transform="rotate(-35 299 91)"/><ellipse cx="330" cy="75" rx="6" ry="9" transform="rotate(25 330 75)"/><ellipse cx="338" cy="99" rx="6" ry="9" transform="rotate(60 338 99)"/><ellipse cx="310" cy="109" rx="6" ry="9" transform="rotate(-60 310 109)"/><circle cx="319" cy="94" r="4" fill="#d18a68"/></g>
    <path d="M111 112c11-10 21-10 32 0m-16-18v31m-13-24 25 16m0-16-25 16" fill="none" stroke="#f3c8d2" stroke-width="2" opacity=".72"/>
    <circle cx="355" cy="67" r="3" fill="#ffcfda"/><circle cx="88" cy="89" r="2" fill="#fff0f3"/><path d="m278 78 2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#f5c3ce"/>
  </svg>`;
  if (kind === 'debt') return `<svg class="heading-art debt-art" viewBox="0 0 150 110" aria-hidden="true"><ellipse cx="77" cy="96" rx="55" ry="8" fill="#e9c5ce"/><path d="m22 67 46-26 49 20-47 27z" fill="#d98aa0"/><path d="m42 52 33-19 34 14-34 20z" fill="#fff9f8" stroke="#e5adba" stroke-width="2"/><path d="m51 51 20-11 22 9-20 12z" fill="#f4d5dd"/><path d="m54 50 9-5m-5 9 13-7" stroke="#bf617b" stroke-width="2" stroke-linecap="round"/><path d="m93 57 22-12 19 8-22 13z" fill="#b84d6c"/><path d="m98 56 17-9 11 5-17 9z" fill="#f9e0e5"/><path d="m99 77 15-8 17 7-16 9z" fill="#f0b8c5"/><circle cx="106" cy="76" r="2" fill="#a84c68"/><circle cx="113" cy="79" r="2" fill="#a84c68"/></svg>`;
  if (kind === 'reimbursement') return `<svg class="heading-art reimbursement-art" viewBox="0 0 150 110" aria-hidden="true"><ellipse cx="76" cy="96" rx="55" ry="8" fill="#e9c5ce"/><path d="m24 69 46-26 50 20-47 27z" fill="#d98aa0"/><path d="m44 55 33-19 34 14-34 20z" fill="#fff9f8" stroke="#e5adba" stroke-width="2"/><path d="m54 53 21-12 22 9-21 12z" fill="#f7e3e7"/><path d="m58 52 12-7m-8 11 17-9" stroke="#bf617b" stroke-width="2" stroke-linecap="round"/><path d="m92 71 22-12 19 8-23 13z" fill="#a64a68"/><path d="m92 71 0 12 18 8 0-11z" fill="#843a57"/><path d="m110 80 23-13v12l-23 12z" fill="#c96f88"/><path d="m98 73 16-9 10 4-17 10z" fill="#f8d9e0"/></svg>`;
  if (kind === 'reports') return `<svg class="heading-art report-art" viewBox="0 0 150 110" aria-hidden="true"><ellipse cx="77" cy="97" rx="54" ry="7" fill="#e9c5ce"/><path d="m39 22 50-8 15 12v55l-50 9-15-12z" fill="#fff9f8" stroke="#dfacb8" stroke-width="2"/><path d="m89 14v15l15-3" fill="#f3d4dc"/><path d="m50 41 37-6m-37 14 27-4" stroke="#c86e85" stroke-width="2" stroke-linecap="round"/><path d="m51 69 10-10 10 6 12-17" fill="none" stroke="#bd5873" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="m54 78 8-5 8 4 10-13" fill="none" stroke="#d99aaa" stroke-width="3" stroke-linecap="round"/><circle cx="121" cy="33" r="13" fill="#f8e3e8"/><path d="m121 22 3 7 7 4-7 3-3 7-3-7-7-3 7-4z" fill="#d36c88"/></svg>`;
  if (kind === 'empty-trend') return `<svg class="empty-art trend-empty-art" viewBox="0 0 120 82" aria-hidden="true"><path d="M18 66h87" stroke="#ead6dc" stroke-width="2" stroke-linecap="round"/><rect x="27" y="44" width="12" height="22" rx="3" fill="#edc1cc"/><rect x="47" y="32" width="12" height="34" rx="3" fill="#d98ba0"/><rect x="67" y="49" width="12" height="17" rx="3" fill="#ead0d7"/><path d="m25 37 20-13 18 8 24-19" fill="none" stroke="#b84d6c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="87" cy="13" r="4" fill="#b84d6c"/><path d="M95 48c-4-8 6-12 10-5 5-6 13-1 9 6l-9 9z" fill="#e6a0b1"/></svg>`;
  if (kind === 'empty-tasks') return `<svg class="empty-art" viewBox="0 0 96 72" aria-hidden="true"><circle cx="48" cy="36" r="25" fill="#f7e8ec"/><circle cx="48" cy="36" r="18" fill="#fff"/><path d="m39 36 6 6 13-14" fill="none" stroke="#b6506d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="m19 20 2 5 5 2-5 2-2 5-2-5-5-2 5-2zM76 48l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="#d98ba0"/></svg>`;
  if (kind === 'empty-search') return `<svg class="empty-art" viewBox="0 0 96 72" aria-hidden="true"><circle cx="39" cy="31" r="21" fill="#fff1f4" stroke="#d78398" stroke-width="4"/><path d="m55 47 20 18" stroke="#a94b68" stroke-width="7" stroke-linecap="round"/><path d="M29 31h20m-10-10v20" stroke="#e2a4b2" stroke-width="3" stroke-linecap="round"/><circle cx="73" cy="17" r="3" fill="#df9eae"/><circle cx="18" cy="57" r="2" fill="#df9eae"/></svg>`;
  return `<svg class="empty-art" viewBox="0 0 96 72" aria-hidden="true"><path d="m17 25 31-16 32 14-32 17z" fill="#f0cbd4"/><path d="M17 25v27l31 16V40z" fill="#d98ca0"/><path d="m48 40 32-17v28L48 68z" fill="#bd6a82"/><path d="m30 26 18-9 18 8-18 10z" fill="#fff9f8"/><path d="m36 26 12-6 11 5-12 6z" fill="#e8a9b7"/><path d="m37 45 8 4m-8 3 8 4" stroke="#fff2f4" stroke-width="2" stroke-linecap="round"/><path d="M71 12c-5-5-12 2-4 8l4 4 4-4c8-6 1-13-4-8z" fill="#df91a5"/><circle cx="70" cy="50" r="3" fill="#f4c6d0"/></svg>`;
}
function typeLabel(type) { return type === 'debt' ? 'Utang usaha' : 'Reimbursement'; }
function sum(rows, getValue) { return rows.reduce((total, row) => total + Number(getValue(row) || 0), 0); }
function percentage(value, total) { return total > 0 ? Number((value / total * 100).toFixed(1)) : 0; }
function money(value) { return moneyFormatter.format(Number(value) || 0); }
function formatDate(value) { if (!value) return '—'; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date); }
function localDate() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function dateInput(name, label, value) {
  return `<label>${label} <span class="required">*</span><input class="field-control" type="date" name="${name}" required value="${escapeAttribute(value || '')}"></label>`;
}
async function attachmentPayload(file, prefix) {
  if (file.size > 3 * 1024 * 1024) throw new Error('Lampiran maksimal berukuran 3 MB.');
  if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Format lampiran harus PDF, JPG, PNG, atau WebP.');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Lampiran tidak dapat dibaca.'));
    reader.onerror = () => reject(new Error('Lampiran tidak dapat dibaca.'));
    reader.readAsDataURL(file);
  });
  return { [`${prefix}_name`]: file.name, [`${prefix}_data`]: data };
}
function parseDateInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (year < 1 || month < 1 || month > 12) return null;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return null;
  return value;
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function escapeAttribute(value) { return escapeHtml(value); }
