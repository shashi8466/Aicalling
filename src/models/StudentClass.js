const supabase = require('../db/supabase');
const logger   = require('../logger');

class StudentClass {
  static async create({ name }) {
    const { data, error } = await supabase
      .from('classes')
      .insert({ name })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  static async find(filter = {}, options = {}) {
    let q = supabase.from('classes').select('*');
    if (options.sort) {
      for (const [key, val] of Object.entries(options.sort)) {
        q = q.order(key, { ascending: val === 1 });
      }
    } else {
      q = q.order('created_at', { ascending: false });
    }
    if (options.limit) q = q.limit(options.limit);
    
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }

  static async findById(id) {
    const { data, error } = await supabase
      .from('classes')
      .select('*')
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data;
  }

  static async findByIdAndUpdate(id, updates) {
    const { data, error } = await supabase
      .from('classes')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  static async findByIdAndDelete(id) {
    const { data, error } = await supabase
      .from('classes')
      .delete()
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // Manage students in a class
  static async addStudents(classId, leadIds) {
    if (!leadIds || !leadIds.length) return [];
    const inserts = leadIds.map(leadId => ({ class_id: classId, lead_id: leadId }));
    const { data, error } = await supabase
      .from('class_students')
      .upsert(inserts, { onConflict: 'class_id,lead_id' })
      .select('lead_id');
    if (error) throw new Error(error.message);
    return data;
  }

  static async removeStudent(classId, leadId) {
    const { error } = await supabase
      .from('class_students')
      .delete()
      .match({ class_id: classId, lead_id: leadId });
    if (error) throw new Error(error.message);
    return true;
  }

  static async getStudentsInClass(classId) {
    // Get class_students join with leads
    const { data, error } = await supabase
      .from('class_students')
      .select('lead_id, leads:lead_id(id, full_name, email, phone, status, grade)')
      .eq('class_id', classId);
    if (error) throw new Error(error.message);
    
    // Map to an array of lead objects
    return (data || []).map(row => row.leads).filter(Boolean);
  }
}

module.exports = StudentClass;
