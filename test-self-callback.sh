#!/bin/bash

# Test Self callback with simulated proof payload
# This simulates what Self relayers would send to your backend

context=$(node -e "console.log(Buffer.from(JSON.stringify({action:'registration',handle:'alice_test',userId:'550e8400-e29b-41d4-a716-446655440000',avatarUrl:'https://api.dicebear.com/7.x/avataaars/svg?seed=alice_test'}),'utf8').toString('hex'))")

curl -X POST http://localhost:3001/auth/self/verify \
  -H "Content-Type: application/json" \
  -d '{
    "attestationId": 1,
    "proof": {
      "a": ["0x1234567890abcdef", "0xfedcba0987654321"],
      "b": [
        ["0xaaaa", "0xbbbb"],
        ["0xcccc", "0xdddd"]
      ],
      "c": ["0xeeee", "0xffff"]
    },
    "pubSignals": [
      "0x0000000000000000000000000000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000000000000000000000000000002"
    ],
    "userContextData": "'$context'"
  }'
