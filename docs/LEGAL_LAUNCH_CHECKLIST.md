# RLVO — Legal & Privacy Launch Checklist

Target launch:
October 2026

Status:
Pre-launch

---

# Corporate

- [ ] Decide final legal entity.
- [ ] Incorporate entity if possible before store submission.
- [ ] Confirm legal name.
- [ ] Confirm RFC when applicable.
- [ ] Confirm business/fiscal address appropriate for Privacy Notice.
- [ ] Confirm legal representative.

---

# Privacy contact

- [x] Create privacidad@rlvo.com.mx.
- [x] Configure as Google Group.
- [x] Deliver messages to founders.
- [x] Test external incoming email.
- [ ] Document internal owner responsible for responding.
- [ ] Create internal privacy-request workflow.

---

# Privacy Notice

- [x] Document categories of data.
- [x] Document product purposes.
- [x] Document profile visibility.
- [x] Document WhatsApp behavior.
- [x] Document location behavior.
- [x] Document personalization.
- [x] Document moderation providers.
- [x] Document retention decisions.
- [x] Document account deletion.
- [x] Document privacy contact.
- [ ] Confirm legal responsible party.
- [ ] Confirm business address.
- [ ] Validate legal bases/finalities with Mexican counsel.
- [ ] Validate ARCO procedure.
- [ ] Validate transfers/provider wording.
- [ ] Validate suspended-account hash retention.
- [ ] Produce final Privacy Notice.
- [ ] Add effective/update date.
- [ ] Remove draft/noindex state after approval.

---

# Terms of Use

- [x] Confirm 18+ requirement.
- [x] Confirm university-email requirement.
- [x] Confirm verification meaning.
- [x] Confirm marketplace model.
- [x] Confirm no RLVO payments.
- [x] Confirm no RLVO logistics.
- [x] Confirm RLVO is not party to transaction.
- [x] Define prohibited products.
- [x] Define moderation.
- [x] Define suspension system.
- [x] Define appeal channel.
- [x] Define user-content ownership.
- [x] Define limited content license.
- [x] Define safety model.
- [ ] Validate limitation-of-liability language with counsel.
- [ ] Validate consumer-protection obligations.
- [ ] Validate governing law/jurisdiction.
- [ ] Validate IP complaint procedure.
- [ ] Produce final Terms.
- [ ] Add effective/update date.
- [ ] Remove draft/noindex state after approval.

---

# Account deletion

- [x] Define in-app route.
- [x] Define password confirmation.
- [x] Define immediate deletion.
- [x] Define deleted data.
- [x] Define anonymized reviews.
- [x] Define report handling.
- [x] Define moderation-record retention.
- [x] Define suspended-account hash behavior.
- [x] Define privacidad@rlvo.com.mx.
- [ ] Implement server-side deletion operation.
- [ ] Test Auth deletion.
- [ ] Test database deletion.
- [ ] Test Storage deletion.
- [ ] Test review anonymization.
- [ ] Test report anonymization.
- [ ] Test moderation retention.
- [ ] Test suspended-email hash.
- [ ] Define verified external deletion-request process.
- [ ] Update /eliminar-cuenta with confirmed final procedure.

---

# Moderation

- [x] OpenAI selected for text.
- [x] Google Cloud Vision selected.
- [x] Amazon Rekognition selected.
- [x] Define content categories.
- [x] Define automated vs human review.
- [x] Define 12-month moderation-record retention.
- [ ] Implement provider disclosure/acceptance UI.
- [ ] Store version/date of applicable acceptance.
- [ ] Enforce requirement server-side.
- [ ] Re-request action if relevant provider configuration changes.
- [ ] Validate legal wording with counsel.

---

# Data retention

- [x] Create retention matrix.
- [x] Reports: 12 months after resolution.
- [x] Moderation records: 12 months.
- [x] Recommendations: 90-day activity window.
- [x] Define review anonymization.
- [ ] Validate indefinite suspended-email hash.
- [ ] Verify actual Supabase implementation.
- [ ] Verify actual Storage deletion.
- [ ] Verify Sentry retention/configuration.
- [ ] Verify provider retention/configuration where configurable.

---

# App

- [ ] Add 18+ confirmation.
- [ ] Ensure institutional domains are validated server-side.
- [ ] Remove exatec.tec.mx.
- [ ] Correct verification copy so it does not imply identity verification.
- [ ] Add privacy acceptance/notice at appropriate point.
- [ ] Add moderation-provider disclosure flow.
- [ ] Add account deletion flow.
- [ ] Add safety recommendations.
- [ ] Link Privacy Notice.
- [ ] Link Terms.
- [ ] Link Content Policy where appropriate.
- [ ] Add non-affiliation clarification where appropriate.
- [ ] Verify push-notification settings behavior.
- [ ] Verify all data flows against LEGAL_FACTS.md.

---

# Website

- [x] Privacy page exists.
- [x] Terms page exists.
- [x] Account deletion page exists.
- [x] Support page exists.
- [x] Contact page exists.
- [x] Add privacidad@rlvo.com.mx where appropriate.
- [x] Replace resolved POR CONFIRMAR markers.
- [x] Keep genuinely unresolved legal items marked as pending.
- [ ] Update privacy page after counsel review.
- [ ] Update terms page after counsel review.
- [ ] Update account deletion page after backend implementation.
- [ ] Add effective dates.
- [ ] Remove noindex from approved legal pages.
- [ ] Verify no analytics/cookies were added unexpectedly.

---

# App Store / Google Play

- [ ] Complete Apple privacy questionnaire using actual production data flows.
- [ ] Complete Google Play Data Safety using actual production data flows.
- [ ] Provide public Privacy Notice URL.
- [ ] Provide public account-deletion URL.
- [ ] Verify store disclosures match application behavior.
- [ ] Verify SDK declarations match production build.
- [ ] Verify 18+ positioning/rating.
- [ ] Review moderation/user-generated-content requirements.

---

# Final legal review

Before public launch provide counsel with:

- LEGAL_FACTS.md
- PRIVACY_SPEC.md
- TERMS_SPEC.md
- ACCOUNT_DELETION.md
- CONTENT_POLICY.md
- DATA_RETENTION.md
- screenshots of registration;
- screenshots of privacy/moderation disclosures;
- screenshots of deletion flow;
- list of production SDKs;
- list of production providers.

Ask counsel specifically to review:

1. Privacy Notice.
2. ARCO procedure.
3. provider/transfer disclosures.
4. retention periods.
5. suspended-account hash.
6. Terms of Use.
7. limitation of liability.
8. consumer law.
9. governing law/jurisdiction.
10. intellectual-property complaints.
11. age restriction.
12. moderation disclosures.

---

# Release rule

Do not consider the legal implementation complete merely because the website contains legal pages.

Production is ready only when:

DOCUMENTATION
=
ACTUAL APP BEHAVIOR
=
DATABASE BEHAVIOR
=
STORAGE BEHAVIOR
=
PROVIDER CONFIGURATION
=
STORE DISCLOSURES

Any material change to one should trigger review of the others.
