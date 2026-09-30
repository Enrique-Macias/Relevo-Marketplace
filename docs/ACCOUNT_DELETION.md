# RLVO — Account Deletion Specification

Status: Confirmed product behavior
Legal review: Required for retention exceptions

---

# User-facing route

Website:

https://rlvo.com.mx/eliminar-cuenta

In-app route:

Perfil
→ Configuración
→ Eliminar cuenta

---

# Primary deletion method

Account deletion is performed directly inside the RLVO mobile application.

The user must confirm the operation using their password.

There is no waiting period.

Deletion begins immediately after successful confirmation.

---

# Information deleted

The deletion flow must remove the user's personal account information, including:

- profile;
- institutional email;
- phone number;
- profile photo;
- listings;
- listing photos;
- favorites;
- contact records attributable to the user;
- interests;
- push notification tokens;
- reviews received;
- buyer record;
- notifications or references containing the user's name or listings where applicable.

Supabase Storage objects belonging to the deleted profile/listings must also be removed.

---

# Reviews written by deleted user

Reviews written by the user are anonymized.

Retain:

- star rating.

Remove:

- author identity;
- written comment.

Reviews received by the deleted account are deleted.

---

# Reports

Reports created or received by the deleted user may remain only without the deleted user's identity.

Retention:

12 months after resolution where applicable.

---

# Moderation records

Minimal moderation records may remain for:

12 months.

They must not preserve the original photographs solely for this purpose.

---

# Suspended accounts

If the account was suspended when deleted:

RLVO may retain a SHA-256 hash derived from the institutional email solely to prevent re-registration with the same institutional email.

The original email is deleted.

Product decision:
retain hash indefinitely.

Legal status:
requires validation before production.

---

# No recovery period

There is no soft-delete recovery period planned for the user account.

Do not tell users that they can restore an account after deletion unless this behavior is intentionally implemented later.

---

# Website deletion page

`/eliminar-cuenta` should explain:

1. that users can delete their account from the app;
2. the exact in-app route;
3. that password confirmation is required;
4. that deletion begins immediately;
5. major categories of information deleted;
6. categories that may remain anonymized or retained;
7. how suspended-account prevention works, if legally approved;
8. how to contact RLVO for assistance.

Privacy contact:

privacidad@rlvo.com.mx

Support:

soporte@rlvo.com.mx

---

# External request

If a user cannot access the application, the website may instruct them to contact:

privacidad@rlvo.com.mx

RLVO must verify the requester's identity before deleting an account.

The verification procedure must use the minimum information necessary.

Do not create an unauthenticated account-deletion API endpoint.

---

# Security requirements

Deletion must occur server-side.

Never expose:

- Supabase service_role;
- administrative credentials;
- privileged deletion functions;

to the mobile client or public website.

Deletion should be implemented as an authenticated server-side operation.

---

# Required implementation verification

Before production verify that deletion actually removes:

- Supabase Auth user;
- profile row;
- phone;
- email references;
- profile Storage objects;
- listing rows;
- listing Storage objects;
- favorites;
- contact records;
- interests;
- push tokens;
- received reviews;
- buyer relationships;
- relevant notifications.

Also verify anonymization/retention logic for:

- written reviews;
- reports;
- moderation records;
- suspended-email hash.

---

# Legal validation

Validate before launch:

- indefinite suspended-email hash retention;
- retention periods;
- anonymization standard;
- identity verification for external requests;
- any legally required retention exceptions.