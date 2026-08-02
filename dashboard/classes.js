let allClasses = [];
let currentClassId = null;
let currentClassStudents = [];
let cdpSelectedLeads = new Set();
let addStudentsLeadsList = [];
let addStudentsSelected = new Set();

document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-view]');
    if (a && a.dataset.view === 'classes') {
        loadClasses();
        // Since custom views don't trigger the built-in view switcher easily without being registered in index.js nav list,
        // wait, index.html navigation logic listens to a[data-view] automatically and loops through sections with id="view-X".
        // It should automatically switch it.
    }
});

async function loadClasses() {
    try {
        const res = await fetch('/api/classes');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load classes');
        allClasses = data;
        renderClassesTable();
    } catch(e) {
        console.error(e);
        toast('Error loading classes: ' + e.message, 'error');
    }
}

function renderClassesTable() {
    const tableDiv = document.getElementById('classesTable');
    if (!allClasses || allClasses.length === 0) {
        tableDiv.innerHTML = '<div class="empty"><div class="icon">🏫</div><p>No classes found. Create one to get started.</p></div>';
        return;
    }
    
    let html = `<table>
        <thead>
            <tr>
                <th>Class Name</th>
                <th>Created</th>
                <th style="text-align:right">Actions</th>
            </tr>
        </thead>
        <tbody>`;
        
    allClasses.forEach(cls => {
        html += `
            <tr onclick="viewClass('${cls.id}')">
                <td style="font-weight:600">${cls.name}</td>
                <td>${new Date(cls.created_at).toLocaleDateString()}</td>
                <td style="text-align:right">
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); editClass('${cls.id}', '${cls.name.replace(/'/g, "\\'")}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteClass('${cls.id}')">Delete</button>
                </td>
            </tr>
        `;
    });
    
    html += `</tbody></table>`;
    tableDiv.innerHTML = html;
}

function openClassForm() {
    document.getElementById('classModalId').value = '';
    document.getElementById('classModalName').value = '';
    document.getElementById('classModalDesc').value = '';
    document.getElementById('classModalTitle').textContent = 'Create Class';
    document.getElementById('classModal').style.display = 'flex';
}

function closeClassModal() {
    document.getElementById('classModal').style.display = 'none';
}

function editClass(id, name) {
    document.getElementById('classModalId').value = id;
    document.getElementById('classModalName').value = name;
    document.getElementById('classModalTitle').textContent = 'Edit Class';
    document.getElementById('classModal').style.display = 'flex';
}

async function saveClass() {
    const id = document.getElementById('classModalId').value;
    const name = document.getElementById('classModalName').value.trim();
    if (!name) return showToast('Class name is required', 'error');
    
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/classes/${id}` : '/api/classes';
    
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (!res.ok) throw new Error(await res.text());
        closeClassModal();
        toast(`Class ${id ? 'updated' : 'created'} successfully`, 'success');
        loadClasses();
    } catch(e) {
        toast('Error saving class: ' + e.message, 'error');
    }
}

async function deleteClass(id) {
    if (!confirm('Are you sure you want to delete this class?')) return;
    try {
        const res = await fetch(`/api/classes/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error(await res.text());
        toast('Class deleted', 'success');
        loadClasses();
    } catch(e) {
        toast('Error deleting class: ' + e.message, 'error');
    }
}

async function viewClass(id) {
    currentClassId = id;
    document.getElementById('classesOverview').style.display = 'none';
    document.getElementById('classDetailsPanel').style.display = 'block';
    
    const cls = allClasses.find(c => c.id === id);
    if (cls) document.getElementById('cdpTitle').textContent = cls.name;
    
    await loadClassStudents();
}

function closeClassDetails() {
    currentClassId = null;
    document.getElementById('classesOverview').style.display = 'block';
    document.getElementById('classDetailsPanel').style.display = 'none';
    loadClasses();
}

async function loadClassStudents() {
    if (!currentClassId) return;
    document.getElementById('cdpBadge').textContent = 'Loading...';
    try {
        const res = await fetch(`/api/classes/${currentClassId}`);
        const cls = await res.json();
        if (!res.ok) throw new Error(cls.error || 'Failed to load');
        currentClassStudents = cls.students || [];
        document.getElementById('cdpBadge').textContent = `${currentClassStudents.length} students`;
        cdpSelectedLeads.clear();
        updateCdpBulkBar();
        renderClassStudentsTable();
    } catch(e) {
        toast('Error loading students: ' + e.message, 'error');
    }
}

function refreshClassDetails() {
    loadClassStudents();
}

function filterClassStudents() {
    renderClassStudentsTable();
}

function renderClassStudentsTable() {
    const tableDiv = document.getElementById('classStudentsTable');
    const search = document.getElementById('cdpSearch').value.toLowerCase();
    
    let filtered = currentClassStudents;
    if (search) {
        filtered = filtered.filter(s => 
            (s.full_name||'').toLowerCase().includes(search) || 
            (s.email||'').toLowerCase().includes(search) ||
            (s.phone||'').toLowerCase().includes(search)
        );
    }
    
    if (filtered.length === 0) {
        tableDiv.innerHTML = '<div class="empty"><div class="icon">👥</div><p>No students found.</p></div>';
        return;
    }
    
    let html = `<table>
        <thead>
            <tr>
                <th class="cb-col"><input type="checkbox" onclick="toggleAllCdp(this)"></th>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th style="text-align:right">Action</th>
            </tr>
        </thead>
        <tbody>`;
        
    filtered.forEach(s => {
        const isSel = cdpSelectedLeads.has(s.id);
        html += `
            <tr onclick="toggleCdpLead('${s.id}')">
                <td class="cb-col" onclick="event.stopPropagation()">
                    <input type="checkbox" ${isSel ? 'checked' : ''} onchange="toggleCdpLead('${s.id}')">
                </td>
                <td style="font-weight:600">${s.full_name}</td>
                <td>${s.email || '-'}</td>
                <td>${s.phone || '-'}</td>
                <td><span class="score-badge">${s.status || '-'}</span></td>
                <td style="text-align:right">
                    ${s.status === 'calling'
                      ? `<button class="btn btn-sm" style="background:var(--hot);color:#fff" onclick="event.stopPropagation(); stopCall('${s.id}')">⏹ Stop</button>`
                      : `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); callLead('${s.id}')">📞 Call</button>`
                    }
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); openEditLead('${s.id}')">✏️ Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); removeStudentFromClass('${s.id}')">🗑️ Remove</button>
                </td>
            </tr>
        `;
    });
    html += `</tbody></table>`;
    tableDiv.innerHTML = html;
}

function toggleCdpLead(id) {
    if (cdpSelectedLeads.has(id)) cdpSelectedLeads.delete(id);
    else cdpSelectedLeads.add(id);
    renderClassStudentsTable();
    updateCdpBulkBar();
}

function toggleAllCdp(cb) {
    if (cb.checked) {
        const search = document.getElementById('cdpSearch').value.toLowerCase();
        currentClassStudents.forEach(s => {
            if (search) {
                if ((s.full_name||'').toLowerCase().includes(search) || 
                    (s.email||'').toLowerCase().includes(search) ||
                    (s.phone||'').toLowerCase().includes(search)) {
                    cdpSelectedLeads.add(s.id);
                }
            } else {
                cdpSelectedLeads.add(s.id);
            }
        });
    } else {
        cdpSelectedLeads.clear();
    }
    renderClassStudentsTable();
    updateCdpBulkBar();
}

function updateCdpBulkBar() {
    const bar = document.getElementById('cdpBulkBar');
    const cnt = document.getElementById('cdpBulkCount');
    if (cdpSelectedLeads.size > 0) {
        cnt.textContent = cdpSelectedLeads.size;
        bar.classList.add('visible');
    } else {
        bar.classList.remove('visible');
    }
}

function clearCdpBulkSelect() {
    cdpSelectedLeads.clear();
    renderClassStudentsTable();
    updateCdpBulkBar();
}

async function removeStudentFromClass(leadId) {
    if (!confirm('Remove this student from the class?')) return;
    try {
        const res = await fetch(`/api/classes/${currentClassId}/students/${leadId}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error(await res.text());
        toast('Student removed', 'success');
        cdpSelectedLeads.delete(leadId); 
        loadClassStudents();
    } catch(e) {
        toast('Error removing student: ' + e.message, 'error');
    }
}

async function removeSelectedStudentsFromClass() {
    if (cdpSelectedLeads.size === 0) return;
    if (!confirm(`Remove ${cdpSelectedLeads.size} students from the class?`)) return;
    
    const ids = Array.from(cdpSelectedLeads);
    for (const id of ids) {
        try {
            await fetch(`/api/classes/${currentClassId}/students/${id}`, {
                method: 'DELETE'
            });
        } catch(e) {
            console.error('Failed to remove', id);
        }
    }
    toast('Removed students from class', 'success');
    clearCdpBulkSelect();
    loadClassStudents();
}

async function openAddStudentsToClassModal() {
    document.getElementById('addStudentsModal').style.display = 'flex';
    document.getElementById('addStudentsSearch').value = '';
    addStudentsSelected.clear();
    document.getElementById('addStudentsTableContainer').innerHTML = '<div class="loading">Loading leads...</div>';
    
    try {
        const res = await fetch('/api/leads?limit=5000');
        let leads = await res.json();
        if (!res.ok) throw new Error(leads.error || 'Failed to load');
        
        const existingIds = new Set(currentClassStudents.map(s => s.id));
        addStudentsLeadsList = leads.filter(l => !existingIds.has(l.id));
        
        renderAddStudentsTable();
    } catch(e) {
        document.getElementById('addStudentsTableContainer').innerHTML = '<div class="empty">Error loading leads: ' + e.message + '</div>';
    }
}

function closeAddStudentsModal() {
    document.getElementById('addStudentsModal').style.display = 'none';
}

function filterAddStudentsList() {
    renderAddStudentsTable();
}

function renderAddStudentsTable() {
    const search = document.getElementById('addStudentsSearch').value.toLowerCase();
    let filtered = addStudentsLeadsList;
    if (search) {
        filtered = filtered.filter(l => 
            (l.fullName||'').toLowerCase().includes(search) || 
            (l.email||'').toLowerCase().includes(search)
        );
    }
    
    let html = `<table>
        <thead>
            <tr>
                <th class="cb-col"><input type="checkbox" onclick="toggleAllAddStudents(this)"></th>
                <th>Name</th>
                <th>Email</th>
            </tr>
        </thead>
        <tbody>`;
    filtered.forEach(l => {
        const isSel = addStudentsSelected.has(l.id);
        html += `
            <tr onclick="toggleAddStudent('${l.id}')">
                <td class="cb-col" onclick="event.stopPropagation()">
                    <input type="checkbox" ${isSel ? 'checked' : ''} onchange="toggleAddStudent('${l.id}')">
                </td>
                <td>${l.fullName}</td>
                <td>${l.email}</td>
            </tr>
        `;
    });
    html += `</tbody></table>`;
    document.getElementById('addStudentsTableContainer').innerHTML = html;
}

function toggleAddStudent(id) {
    if (addStudentsSelected.has(id)) addStudentsSelected.delete(id);
    else addStudentsSelected.add(id);
    renderAddStudentsTable();
}

function toggleAllAddStudents(cb) {
    if (cb.checked) {
        const search = document.getElementById('addStudentsSearch').value.toLowerCase();
        addStudentsLeadsList.forEach(l => {
            if (search) {
                if ((l.fullName||'').toLowerCase().includes(search) || (l.email||'').toLowerCase().includes(search)) {
                    addStudentsSelected.add(l.id);
                }
            } else {
                addStudentsSelected.add(l.id);
            }
        });
    } else {
        addStudentsSelected.clear();
    }
    renderAddStudentsTable();
}

async function confirmAddStudents() {
    if (addStudentsSelected.size === 0) return showToast('No students selected', 'error');
    
    try {
        const res = await fetch(`/api/classes/${currentClassId}/students`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadIds: Array.from(addStudentsSelected) })
        });
        if (!res.ok) throw new Error(await res.text());
        closeAddStudentsModal();
        toast('Students added successfully', 'success');
        loadClassStudents();
    } catch(e) {
        toast('Error adding students: ' + e.message, 'error');
    }
}

let launchTarget = 'all';

function openLaunchCampaignModal(targetType) {
    launchTarget = targetType;
    let count = 0;
    if (targetType === 'all') count = currentClassStudents.length;
    else count = cdpSelectedLeads.size;
    
    if (count === 0) return toast('No students to launch campaign for', 'error');
    
    document.getElementById('launchCampaignInfo').textContent = `Launching campaign for ${count} student(s)`;
    document.getElementById('launchCampaignModal').style.display = 'flex';
    updateLaunchCampaignFields();
}

function closeLaunchCampaignModal() {
    document.getElementById('launchCampaignModal').style.display = 'none';
}

function updateLaunchCampaignFields() {
    const type = document.getElementById('launchCampaignType').value;
    const container = document.getElementById('launchCampaignVarsFields');
    let html = '';
    
    if (type === 'sat-summer-challenge') {
        html += `
            <div style="font-size:12px;color:var(--muted);background:var(--panel2);padding:10px 12px;border-radius:6px;border:1px solid var(--border);">
                ☀️ The AI will announce the <strong>SAT Summer Digital Challenge</strong> script to the selected student(s) and reward details ($10 Visa Gift Card).
            </div>
        `;
    } else if (type === 'parent-homework') {
        html += `
            <div class="form-group" style="margin-bottom:12px;">
                <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--muted)">Homework Topic <span style="color:var(--hot)">*</span></label>
                <input type="text" id="lc_homeworkTopic" placeholder="e.g. Circles, Algebra, Probability..." style="width:100%;background:var(--panel2);color:var(--text);border:1px solid var(--border);padding:8px 12px;border-radius:6px;">
                <div style="font-size:11px;color:var(--muted);margin-top:4px;">The AI will say: "Your homework topic for today is [topic]. Please complete your [topic] homework..."</div>
            </div>
        `;
    } else if (type === 'parent-absent') {
        html += `
            <div class="form-group" style="margin-bottom:12px;">
                <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--muted)">Class Name (for absent call) <span style="color:var(--hot)">*</span></label>
                <input type="text" id="lc_className" placeholder="e.g. SAT Morning Batch, ACT Wednesday Class..." style="width:100%;background:var(--panel2);color:var(--text);border:1px solid var(--border);padding:8px 12px;border-radius:6px;">
                <div style="font-size:11px;color:var(--muted);margin-top:4px;">The AI will say: "We noticed you were absent for [class name]..."</div>
            </div>
        `;
    } else if (type === 'parent-flt') {
        html += `
            <div class="form-group" style="margin-bottom:12px;">
                <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--muted)">Test Name <span style="color:var(--hot)">*</span></label>
                <input type="text" id="lc_testName" placeholder="e.g. Digital SAT Full-Length Test 5, ACT Practice Test 3..." style="width:100%;background:var(--panel2);color:var(--text);border:1px solid var(--border);padding:8px 12px;border-radius:6px;">
                <div style="font-size:11px;color:var(--muted);margin-top:4px;">The AI will say: "This is a reminder that you have not completed [test name]..."</div>
            </div>
        `;
    }
    container.innerHTML = html;
}

async function confirmLaunchCampaign() {
    const campaignId = document.getElementById('launchCampaignType').value;
    const campaignVars = {};
    
    if (campaignId === 'parent-homework') {
        const el = document.getElementById('lc_homeworkTopic');
        campaignVars.homeworkTopic = el ? el.value.trim() : '';
        if (!campaignVars.homeworkTopic) return toast('Homework Topic is required', 'error');
    } else if (campaignId === 'parent-absent') {
        const el = document.getElementById('lc_className');
        campaignVars.className = el ? el.value.trim() : '';
        if (!campaignVars.className) return toast('Class Name is required', 'error');
    } else if (campaignId === 'parent-flt') {
        const el = document.getElementById('lc_testName');
        campaignVars.testName = el ? el.value.trim() : '';
        if (!campaignVars.testName) return toast('Test Name is required', 'error');
    }
    
    const payload = { campaignId, campaignVars };
    if (launchTarget === 'all') {
        payload.classId = currentClassId;
    } else {
        payload.leadIds = Array.from(cdpSelectedLeads);
    }
        
    try {
        const res = await fetch('/api/leads/bulk-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
        closeLaunchCampaignModal();
        
        const count = launchTarget === 'all' ? currentClassStudents.length : payload.leadIds.length;
        toast(`Launched ${campaignId} for ${count} students!`, 'success');
        clearCdpBulkSelect();
    } catch (e) {
        toast('Error launching campaign: ' + e.message, 'error');
    }
}
