import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config({ path: './backend/.env' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const users = await mongoose.connection.collection('users').find({ role: { $in: ['admin', 'super_admin'] } }).toArray();
  console.log('Admins:', users.map(u => ({ id: u._id, name: u.name, phone: u.phoneE164, role: u.role })));
  await mongoose.disconnect();
}
run().catch(console.error);
