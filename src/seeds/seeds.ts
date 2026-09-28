import { Role } from '../../prisma/generated/prisma/enums';
import bcrypt from 'bcryptjs';
import { prisma } from "@/app/lib/prisma";

const ZONES = [
  { id: 'z-banani',      name: 'Banani',      lat: 23.7936, lng: 90.4043, cluster: 'banani-corridor' },
  { id: 'z-mohakhali',   name: 'Mohakhali',   lat: 23.7666, lng: 90.4074, cluster: 'banani-corridor' },
  { id: 'z-gulshan1',    name: 'Gulshan 1',   lat: 23.7736, lng: 90.4161, cluster: 'banani-corridor' },
  { id: 'z-dhanmondi',   name: 'Dhanmondi',   lat: 23.7461, lng: 90.3742, cluster: 'dhanmondi-mirpur' },
  { id: 'z-mirpur',      name: 'Mirpur',      lat: 23.8223, lng: 90.3654, cluster: 'dhanmondi-mirpur' },
  { id: 'z-uttara',      name: 'Uttara',      lat: 23.8759, lng: 90.3795, cluster: 'uttara-airport' },
  { id: 'z-farmgate',    name: 'Farmgate',    lat: 23.7580, lng: 90.3900, cluster: 'central' },
  { id: 'z-bashundhara', name: 'Bashundhara', lat: 23.8223, lng: 90.4265, cluster: 'east' },
];

const USERS = [
  { id: 'u-jashim-001', name: 'Jashim', email: 'jashim@tesla.dhaka', role: Role.DRIVER },
  { id: 'u-nusrat-001', name: 'Nusrat', email: 'nusrat@example.com', role: Role.PASSENGER },
  { id: 'u-rafiq-001',  name: 'Rafiq',  email: 'rafiq@example.com',  role: Role.PASSENGER },
  { id: 'u-shirin-001', name: 'Shirin', email: 'shirin@example.com', role: Role.PASSENGER },
];

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);

  for (const z of ZONES) {
    await prisma.zone.upsert({ where: { id: z.id }, update: z, create: z });
  }

  for (const u of USERS) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { name: u.name, email: u.email, role: u.role },
      create: { ...u, passwordHash },
    });
  }

  await prisma.tesla.upsert({
    where: { driverId: 'u-jashim-001' },
    update: { label: 'Bullet', capacity: 3 },
    create: { driverId: 'u-jashim-001', label: 'Bullet', capacity: 3, isOnline: false },
  });

  console.log('✓ Seed complete: 8 zones, 4 users, 1 Tesla (Bullet, capacity 3).');
  console.log('  Demo password for all users: password123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());