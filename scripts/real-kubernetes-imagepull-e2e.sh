#!/usr/bin/env bash
# This is intentionally a live-only validation harness. It has no mock mode.
set -euo pipefail

command -v kubectl >/dev/null || { echo 'BLOCKED — LIVE KUBERNETES ENVIRONMENT REQUIRED: kubectl unavailable'; exit 2; }
kubectl cluster-info >/dev/null 2>&1 || { echo 'BLOCKED — LIVE KUBERNETES ENVIRONMENT REQUIRED: cluster unreachable or kubeconfig unavailable'; exit 2; }
: "${SKYOPS_API_URL:?Set SKYOPS_API_URL to the reachable SkyOps backend URL}"
: "${SKYOPS_CLUSTER_ID:?Set SKYOPS_CLUSTER_ID to the registered live cluster ID}"
: "${SKYOPS_ORG_ID:?Set SKYOPS_ORG_ID to the owning organization ID}"
: "${SKYOPS_USER_TOKEN:?Set SKYOPS_USER_TOKEN to an authenticated human Firebase token}"
: "${SKYOPS_GOOD_IMAGE:?Set SKYOPS_GOOD_IMAGE explicitly; SkyOps must not invent it}"
api="${SKYOPS_API_URL%/}"; auth=(-H "Authorization: Bearer $SKYOPS_USER_TOKEN" -H "x-org-id: $SKYOPS_ORG_ID")
kubectl delete pod nginx-test -n default --ignore-not-found
kubectl run nginx-test --image=nginxbadimage -n default
deadline=$((SECONDS + ${SKYOPS_E2E_TIMEOUT_SECONDS:-300})); incident=''
while (( SECONDS < deadline )); do
  kubectl get pod nginx-test -n default -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null | grep -Eq 'ErrImagePull|ImagePullBackOff' || { sleep 3; continue; }
  incidents=$(curl -fsS "${auth[@]}" "$api/api/v1/incidents?clusterId=$SKYOPS_CLUSTER_ID") || { sleep 3; continue; }
  incident=$(node -e 'const d=JSON.parse(process.argv[1]);const i=d.incidents.find(x=>x.resourceName==="nginx-test"&&(x.incidentType==="ImagePullBackOff"||x.incidentType==="ErrImagePull"));if(i)process.stdout.write(i.id)' "$incidents")
  [[ -n "$incident" ]] && break; sleep 3
done
[[ -n "$incident" ]] || { echo 'FAIL: Agent telemetry did not create an ImagePullBackOff incident'; exit 1; }
detail=$(curl -fsS "${auth[@]}" "$api/api/v1/incidents/$incident")
container=$(node -e 'const i=JSON.parse(process.argv[1]).incident;const c=i.technicalDetails.containers?.find(c=>c.waitingReason==="ImagePullBackOff"||c.waitingReason==="ErrImagePull");if(!c)process.exit(1);process.stdout.write(c.name)' "$detail")
current=$(node -e 'const i=JSON.parse(process.argv[1]).incident;const c=i.technicalDetails.containers.find(c=>c.name===process.argv[2]);process.stdout.write(c.image)' "$detail" "$container")
echo "Human approval required: incident=$incident resource=default/nginx-test container=$container field=/spec/containers/$container/image current=$current proposed=$SKYOPS_GOOD_IMAGE"
read -r -p 'Type APPROVE to submit this authenticated approval: ' answer
[[ "$answer" == APPROVE ]] || { echo 'STOPPED at human approval boundary'; exit 0; }
curl -fsS "${auth[@]}" -H 'Content-Type: application/json' -X POST "$api/api/v1/incidents/$incident/remediations/replace-pod-image/approve" --data "{\"container\":\"$container\",\"expectedCurrentValue\":\"$current\",\"proposedValue\":\"$SKYOPS_GOOD_IMAGE\"}" >/dev/null
kubectl wait --for=condition=Ready pod/nginx-test -n default --timeout=180s
while (( SECONDS < deadline )); do
  detail=$(curl -fsS "${auth[@]}" "$api/api/v1/incidents/$incident")
  result=$(node -e 'const d=JSON.parse(process.argv[1]);process.stdout.write(`${d.incident.status}:${d.timeline.some(e=>e.type==="REMEDIATION_EXECUTED"&&e.actor.type==="AGENT")}`)' "$detail")
  [[ "$result" == 'RESOLVED:true' ]] && { echo "PASS: action was executed by Agent and fresh telemetry resolved $incident"; exit 0; }; sleep 3
done
echo 'FAIL: remediation action was not received/executed by the Agent, or fresh telemetry did not resolve the incident'; exit 1
