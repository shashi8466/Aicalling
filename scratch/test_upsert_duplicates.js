require('dotenv').config();
const supabase = require('../src/db/supabase');

async function test() {
    try {
        const classId = '8d31b2cf-3eb4-4584-83b4-0d1bbdf33577';
        const leadId = 'd2aec141-2bf8-499f-ac56-a7a66c5b476b';
        
        const inserts = [
            { class_id: classId, lead_id: leadId },
            { class_id: classId, lead_id: leadId } // Duplicate in the same array
        ];
        
        console.log('Inserting...', inserts);
        const { data, error } = await supabase
            .from('class_students')
            .upsert(inserts, { onConflict: 'class_id,lead_id' })
            .select('lead_id');
            
        if (error) {
            console.error('Supabase Error:', error.message);
        } else {
            console.log('Success:', data);
        }
    } catch(e) {
        console.error('Exception:', e.message);
    }
}
test();
