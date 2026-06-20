import axios from 'axios';
import type { SensorAlert } from '../types/index.js';

const RAILWAY_GQL = 'https://backboard.railway.com/graphql/v2';

interface ServiceStatus {
  name: string;
  status: string;
  deploymentStatus?: string;
  healthCheckPath?: string;
}

export async function checkRailway(): Promise<SensorAlert[]> {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) return [];

  const alerts: SensorAlert[] = [];

  try {
    const res = await axios.post(
      RAILWAY_GQL,
      {
        query: `{
          me {
            projects {
              edges {
                node {
                  id
                  name
                  services {
                    edges {
                      node {
                        id
                        name
                        deployments(last: 1) {
                          edges {
                            node {
                              status
                              createdAt
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const projects = res.data?.data?.me?.projects?.edges ?? [];

    for (const { node: project } of projects) {
      const services: ServiceStatus[] = project.services?.edges?.map(
        ({ node: svc }: { node: { name: string; deployments: { edges: { node: { status: string } }[] } } }) => ({
          name: svc.name,
          status: svc.deployments?.edges?.[0]?.node?.status ?? 'UNKNOWN',
        })
      ) ?? [];

      const failedServices = services.filter(s =>
        ['FAILED', 'CRASHED', 'REMOVED'].includes(s.status)
      );

      if (failedServices.length > 0) {
        alerts.push({
          system: `Railway: ${project.name}`,
          severity: 'high',
          title: `サービス障害: ${failedServices.map(s => s.name).join(', ')}`,
          rawData: {
            summary: `${failedServices.length}サービスがダウン状態`,
            services: failedServices,
            projectName: project.name,
          },
          detectedAt: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.warn('[Railway sensor] チェック失敗:', err);
  }

  return alerts;
}
