import assert from 'node:assert/strict';
import { parsePsebTechHubHtml } from './pseb.js';

const html = `<!doctype html><html><body>
<section class="company-card">
  <h3>Example Software House</h3>
  <p>Islamabad</p>
  <strong>EXPERTISE</strong>
  <span>Software Development</span><span>Mobile App Development</span>
  <a href="https://example-software.pk/">View Profile</a>
</section>
<section class="freelancer-card">
  <h3>Example Freelancer</h3>
  <strong>EXPERTISE</strong><span>Digital Marketing</span>
  <a href="https://www.linkedin.com/in/example">View Profile</a>
</section>
<section class="company-card">
  <h3>Cyber Secure Pakistan</h3>
  <p>Karachi</p>
  <strong>EXPERTISE</strong><span>Cybersecurity</span><span>Network Security</span>
  <a href="https://cybersecure.example/">View Profile</a>
</section>
</body></html>`;

const result = parsePsebTechHubHtml(html, '2026-07-13T12:00:00.000Z');
assert.equal(result.leads.length, 2);
assert.equal(result.skippedLinks, 1);
assert.equal(result.leads[0]?.companyWebsite, 'https://example-software.pk/');
assert.equal(result.leads[0]?.country, 'Pakistan');
assert.equal(result.leads[0]?.discoverySource, 'PSEB Tech Hub collection');
assert.equal(result.leads[0]?.opportunityStatus, 'partnership_target');
assert.equal(result.leads[1]?.serviceCategory, 'cybersecurity_compliance');
assert.ok(result.leads.every((lead) => lead.id.startsWith('pseb-')));

console.log('PSEB Tech Hub parser tests passed');
