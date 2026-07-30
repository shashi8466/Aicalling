require('dotenv').config();
const api = require('./src/routes/api');
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api', api);

// Mock Lead model to avoid DB connection
const Lead = require('./src/models/Lead');
Lead.findById = async (id) => ({
  _id: id,
  fullName: 'Test API Student',
  email: 'testapi@example.com',
  phone: '1234567890'
});

async function run() {
  const request = require('supertest');
  
  console.log('Testing /api/leads/:id/email...');
  const res = await request(app)
    .post(`/api/leads/mock_id/email`)
    .send({ type: 'welcome' });
    
  console.log('Status:', res.status);
  console.log('Body:', res.body);
}

run().catch(console.error);
