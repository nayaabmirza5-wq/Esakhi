import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config({ path: './backend/.env' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const users = await mongoose.connection.collection('users').find({ role: 'seller' }).toArray();
  console.log('Sellers:', users.map(u => ({ id: u._id, name: u.name, phone: u.phoneE164 })));
  await mongoose.disconnect();
}
run().catch(console.error);
