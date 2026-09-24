import { prisma } from '../../lib/prisma';

export async function getAllZones() {
  return prisma.zone.findMany({
    select: { id: true, name: true, lat: true, lng: true, cluster: true },
    orderBy: { name: 'asc' },
  });
}