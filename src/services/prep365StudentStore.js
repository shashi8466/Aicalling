/**
 * Prep365 Student Store
 * Persists and retrieves students who need attention from Supabase (table: prep365_students)
 * with a resilient local cache fallback so the page always loads fast.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const CACHE_DIR = path.resolve(__dirname, '../../data');
const CACHE_FILE = path.join(CACHE_DIR, 'prep365_students_cache.json');

class Prep365StudentStore {
  constructor() {
    this._ensureCacheDir();
    this._hasCheckedTable = false;
    this._tableExists = false;
  }

  _ensureCacheDir() {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
    } catch (_) {}
  }

  _getSupabase() {
    try {
      return require('../db/supabase');
    } catch (e) {
      return null;
    }
  }

  async _checkTableExists() {
    if (this._hasCheckedTable) return this._tableExists;
    const sb = this._getSupabase();
    if (!sb) {
      this._tableExists = false;
      this._hasCheckedTable = true;
      return false;
    }
    try {
      const { error } = await sb.from('prep365_students').select('id').limit(1);
      if (error && (error.code === 'PGRST205' || error.message.includes('not find the table'))) {
        this._tableExists = false;
      } else {
        this._tableExists = true;
      }
    } catch (e) {
      this._tableExists = false;
    }
    this._hasCheckedTable = true;
    return this._tableExists;
  }

  _readLocalCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      logger.warn('[Prep365Store] Failed to read local cache:', e.message);
    }
    return { testMode: true, testStudentIds: [], count: 0, callableCount: 0, byReason: {}, students: [] };
  }

  _writeLocalCache(data) {
    try {
      this._ensureCacheDir();
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      logger.warn('[Prep365Store] Failed to write local cache:', e.message);
    }
  }

  /**
   * Upsert a list of normalized students into Supabase and local cache.
   */
  async upsertStudents(metaAndStudents) {
    const { testMode = false, testStudentIds = [], count = 0, callableCount = 0, byReason = {}, students = [], thresholds = null } = metaAndStudents;
    const cachePayload = {
      testMode,
      testStudentIds,
      count: count || students.length,
      callableCount,
      byReason,
      thresholds,
      students,
      updatedAt: new Date().toISOString()
    };

    // Always update local cache
    this._writeLocalCache(cachePayload);

    // Try Supabase if table is present
    const sb = this._getSupabase();
    const tableExists = await this._checkTableExists();

    if (sb && tableExists && students.length > 0) {
      try {
        const rows = students.map(s => {
          const studentInfo = s.student || s;
          return {
            id: String(studentInfo.id),
            student_name: studentInfo.name || 'Unknown',
            student_email: studentInfo.email || '',
            phone: studentInfo.phone || '',
            grade: studentInfo.grade || s.grade || '',
            reasons: s.reasons || [],
            activity: s.activity || {},
            tests: s.tests || {},
            custom_prep: s.customPrep || [],
            parents: s.parents || [],
            talking_points: s.talkingPoints || '',
            priority: s.priority || 0,
            call_status: s.callStatus || {},
            raw_data: s,
            updated_at: new Date().toISOString()
          };
        });

        const { error } = await sb.from('prep365_students').upsert(rows, { onConflict: 'id' });
        if (error) {
          logger.warn('[Prep365Store] Supabase upsert error:', error.message);
        } else {
          logger.info(`[Prep365Store] Synced ${rows.length} student(s) to Supabase prep365_students table.`);
        }
      } catch (err) {
        logger.warn('[Prep365Store] Supabase write failed:', err.message);
      }
    }

    return cachePayload;
  }

  /**
   * Get students and metadata from Supabase (or local cache).
   */
  async getStudents() {
    // The latest sync (exact Prep365 list + its count/byReason/callableCount) wins.
    const local = this._readLocalCache();
    if (local.students && local.students.length > 0) return local;

    // Disk was wiped (e.g. redeploy): rebuild from Supabase, using only rows written
    // by the most recent sync so students who no longer need attention don't linger.
    const sb = this._getSupabase();
    const tableExists = await this._checkTableExists();

    if (sb && tableExists) {
      try {
        const { data: allRows, error } = await sb
          .from('prep365_students')
          .select('*')
          .order('priority', { ascending: false });
        const latest = (allRows || []).reduce((m, r) => Math.max(m, Date.parse(r.updated_at) || 0), 0);
        const data = (allRows || []).filter(r => (Date.parse(r.updated_at) || 0) >= latest - 10 * 60 * 1000);

        if (!error && data && data.length > 0) {
          const mappedStudents = data.map(r => {
            if (r.raw_data && r.raw_data.student) {
              return {
                ...r.raw_data,
                callStatus: r.call_status || r.raw_data.callStatus || {}
              };
            }
            return {
              student: {
                id: r.id,
                name: r.student_name,
                email: r.student_email,
                phone: r.phone,
                grade: r.grade
              },
              parents: r.parents || [],
              activity: r.activity || {},
              tests: r.tests || {},
              customPrep: r.custom_prep || [],
              reasons: r.reasons || [],
              talkingPoints: r.talking_points || '',
              priority: r.priority || 0,
              callStatus: r.call_status || {}
            };
          });

          // Compute byReason and callableCount
          const byReason = {};
          let callableCount = 0;
          for (const s of mappedStudents) {
            if (s.callStatus?.callable) callableCount++;
            for (const r of (s.reasons || [])) {
              const code = r.code || r;
              byReason[code] = (byReason[code] || 0) + 1;
            }
          }

          return {
            testMode: local.testMode ?? (process.env.PREP365_DRY_RUN === 'true'),
            testStudentIds: local.testStudentIds || [],
            count: mappedStudents.length,
            callableCount,
            byReason,
            students: mappedStudents,
            updatedAt: local.updatedAt || new Date().toISOString()
          };
        }
      } catch (err) {
        logger.warn('[Prep365Store] Error reading Supabase prep365_students:', err.message);
      }
    }

    // Fallback to local cache
    return this._readLocalCache();
  }

  /**
   * Get a single student by id with full snapshot and call history.
   */
  async getStudentById(id) {
    const all = await this.getStudents();
    return all.students.find(s => (s.student?.id === id || s.id === id)) || null;
  }

  /**
   * Update student's call status in store and cache.
   */
  async updateStudentCallStatus(studentId, callOutcome) {
    const cached = this._readLocalCache();
    let updated = false;

    if (cached.students && cached.students.length > 0) {
      for (const s of cached.students) {
        if (s.student?.id === studentId || s.id === studentId) {
          s.callStatus = s.callStatus || {};
          s.callStatus.totalCalls = (s.callStatus.totalCalls || 0) + 1;
          s.callStatus.lastCall = {
            status: callOutcome.status || 'completed',
            at: callOutcome.timestamp || new Date().toISOString(),
            durationSeconds: callOutcome.durationSeconds || callOutcome.duration || 0,
            summary: callOutcome.summary || '',
            recordingUrl: callOutcome.recordingUrl || null,
            transcript: callOutcome.transcript || ''
          };
          if (callOutcome.optOut) {
            s.callStatus.callable = false;
            s.callStatus.blockedReason = 'opted_out';
          }
          updated = true;
          break;
        }
      }
      if (updated) {
        this._writeLocalCache(cached);
      }
    }

    // Also update Supabase if table exists
    const sb = this._getSupabase();
    const tableExists = await this._checkTableExists();
    if (sb && tableExists) {
      try {
        const student = await this.getStudentById(studentId);
        if (student) {
          await sb.from('prep365_students').update({
            call_status: student.callStatus,
            updated_at: new Date().toISOString()
          }).eq('id', studentId);
        }
      } catch (_) {}
    }
  }
}

module.exports = new Prep365StudentStore();
