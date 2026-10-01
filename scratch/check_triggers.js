require('dotenv').config();
const supabase = require('../src/db/supabase');

async function test() {
    try {
        const { data, error } = await supabase.rpc('get_triggers', {});
        console.log('Result:', data, error);
        
        // Alternatively, since we might not have a get_triggers RPC:
        const { data: d2, error: e2 } = await supabase.from('class_students').select('*').limit(1);
        console.log('Test query:', d2, e2);
    } catch (e) {
        console.error('Exception:', e);
    }
}
test();
