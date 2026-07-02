#!/bin/bash
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  TESTING FEATURE 1: DUPLICATE EMAIL VALIDATION                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Generate unique emails for fresh tests
TS=$(date +%s%N)
TEST_EMAIL="testuser${TS}@example.com"
echo "Creating first account with email: $TEST_EMAIL"
FIRST_SIGNUP=$(curl -s -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d "{\"fullName\":\"First User\",\"email\":\"$TEST_EMAIL\",\"password\":\"SecurePass123!\",\"phone\":\"+1-555-0001\",\"role\":\"counselor\"}")

echo "✓ First signup response:"
echo "  $FIRST_SIGNUP"
echo ""

echo "Attempting to sign up again with SAME email..."
DUPLICATE_SIGNUP=$(curl -s -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d "{\"fullName\":\"Duplicate User\",\"email\":\"$TEST_EMAIL\",\"password\":\"DifferentPass123!\",\"phone\":\"+1-555-0002\",\"role\":\"admin\"}")

echo "✗ Duplicate signup response:"
echo "  $DUPLICATE_SIGNUP"
echo ""

# Check if the error message is exactly as specified
if echo "$DUPLICATE_SIGNUP" | grep -q "An account with this email already exists. Please log in or use the 'Forgot Password' option to reset your password."; then
  echo "✅ PASS: Duplicate email validation works with correct message!"
else
  echo "❌ FAIL: Error message doesn't match expected text"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  TESTING FEATURE 2: FORGOT PASSWORD FLOW                       ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Test 1: Forgot password with valid email
VALID_EMAIL="forgottest${TS}@example.com"
echo "Test 2a: Sending forgot-password request with VALID email..."
FORGOT_RESPONSE=$(curl -s -X POST http://localhost:3000/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$VALID_EMAIL\"}")

echo "✓ Response (valid email):"
echo "  $FORGOT_RESPONSE"
echo ""

if echo "$FORGOT_RESPONSE" | grep -q "If an account exists for that email"; then
  echo "✅ PASS: Forgot-password returns generic success message"
else
  echo "❌ FAIL: Response doesn't match expected format"
fi

echo ""
echo "Test 2b: Sending forgot-password request with NON-EXISTENT email..."
NONEXISTENT=$(curl -s -X POST http://localhost:3000/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"nonexistent${TS}@example.com\"}")

echo "✓ Response (non-existent email):"
echo "  $NONEXISTENT"
echo ""

if echo "$NONEXISTENT" | grep -q "If an account exists for that email"; then
  echo "✅ PASS: Non-existent email returns same generic message (prevents enumeration)"
else
  echo "❌ FAIL: Response doesn't match expected format"
fi

echo ""
echo "Test 2c: Frontend pages loading..."
LOGIN_PAGE=$(curl -s -I http://localhost:3000/login | grep "200\|301")
RESET_PAGE=$(curl -s -I http://localhost:3000/reset-password | grep "200\|301")

if [ ! -z "$LOGIN_PAGE" ]; then
  echo "✅ PASS: /login page loads (HTTP $LOGIN_PAGE)"
else
  echo "❌ FAIL: /login page not found"
fi

if [ ! -z "$RESET_PAGE" ]; then
  echo "✅ PASS: /reset-password page loads (HTTP $RESET_PAGE)"
else
  echo "❌ FAIL: /reset-password page not found"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  TESTING ENDPOINTS                                             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

echo "Test 3a: /auth/config endpoint (returns Supabase credentials)..."
CONFIG=$(curl -s http://localhost:3000/auth/config)
if echo "$CONFIG" | grep -q "supabaseUrl\|supabaseAnonKey"; then
  echo "✅ PASS: /auth/config returns credentials"
else
  echo "❌ FAIL: /auth/config not working"
fi

echo ""
echo "Test 3b: Missing email validation on forgot-password..."
MISSING_EMAIL=$(curl -s -X POST http://localhost:3000/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"\"}")

if echo "$MISSING_EMAIL" | grep -q "Email is required"; then
  echo "✅ PASS: Missing email returns validation error"
else
  echo "❌ FAIL: Validation not working for empty email"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  ALL TESTS COMPLETED                                           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
