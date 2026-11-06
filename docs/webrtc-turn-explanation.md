# TURN behavior and deployment status

M² Calls uses ICE to select direct media when possible and coturn relay media
when a relay candidate pair is selected. No universal-connectivity percentage
is claimed. Use the [architecture discussion](../ARCHITECTURE.md) for signaling
versus media and the [canonical Azure guide](azure-deploy.md) for the listener,
firewall, credential, and forced-relay evidence contract.
