import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import inch, mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
    HRFlowable,
)
from reportlab.pdfgen import canvas

# --- NUMBERED CANVAS FOR HEADER & FOOTER WITH TOTAL PAGE COUNT ---
class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_header_footer(num_pages)
            super().showPage()
        super().save()

    def draw_header_footer(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#57534e"))

        # Header (pages 2+)
        if self._pageNumber > 1:
            self.drawString(40, 805, "Bazaar to Home — Return, Refund & Cancellation Policy")
            self.drawRightString(555, 805, "Razorpay Merchant Compliance Document")
            self.setStrokeColor(colors.HexColor("#D1D5DB"))
            self.setLineWidth(0.5)
            self.line(40, 798, 555, 798)

        # Footer (all pages)
        self.setStrokeColor(colors.HexColor("#E5E7EB"))
        self.setLineWidth(0.5)
        self.line(40, 45, 555, 45)

        self.drawString(40, 32, "Bazaar to Home (Damoh, MP) • Operated by eSakhi Technologies • Confidential & Proprietary")
        self.drawRightString(555, 32, f"Page {self._pageNumber} of {page_count}")
        self.restoreState()


def build_pdf(filename):
    doc = SimpleDocTemplate(
        filename,
        pagesize=A4,
        leftMargin=40,
        rightMargin=40,
        topMargin=54,
        bottomMargin=54,
    )

    styles = getSampleStyleSheet()

    # --- BRAND COLOR DEFINITIONS ---
    c_primary = colors.HexColor("#1A4D2E")     # Forest Green
    c_secondary = colors.HexColor("#FF9F1C")   # Warm Amber
    c_dark = colors.HexColor("#2B2B2B")        # Charcoal text
    c_muted = colors.HexColor("#57534E")       # Muted body
    c_bg_light = colors.HexColor("#FFF8E8")    # Cream
    c_accent_bg = colors.HexColor("#E0ECC8")   # Pale green
    c_border = colors.HexColor("#D6D3D1")      # Light border

    # --- CUSTOM STYLES ---
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=c_primary,
    )

    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=c_muted,
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=c_primary,
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=True,
    )

    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=14,
        textColor=c_dark,
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True,
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=c_dark,
        spaceAfter=4,
    )

    body_bold = ParagraphStyle(
        'Body_Bold',
        parent=body_style,
        fontName='Helvetica-Bold',
    )

    bullet_style = ParagraphStyle(
        'Bullet_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=c_dark,
        leftIndent=14,
        firstLineIndent=-10,
        spaceAfter=3,
    )

    callout_style = ParagraphStyle(
        'Callout_Text',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=c_primary,
    )

    th_style = ParagraphStyle(
        'TH_Style',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.white,
    )

    td_style = ParagraphStyle(
        'TD_Style',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=11,
        textColor=c_dark,
    )

    td_bold = ParagraphStyle(
        'TD_Bold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=11,
        textColor=c_dark,
    )

    story = []

    # --- DOCUMENT HEADER & BRAND STRIP ---
    header_data = [
        [
            Paragraph("<b>BAZAAR TO HOME</b><br/><font size=8 color='#57534E'>Damoh Local Online Shopping Marketplace</font>", title_style),
            Paragraph("<b>MERCHANT COMPLIANCE POLICY</b><br/><font size=7.5 color='#57534E'>Consumer Protection (E-Commerce) Rules, 2020<br/>Razorpay Payment Gateway Verification Document</font>", subtitle_style)
        ]
    ]
    t_header = Table(header_data, colWidths=[315, 200])
    t_header.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('ALIGN', (1,0), (1,0), 'RIGHT'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(t_header)
    story.append(Spacer(1, 8))

    story.append(HRFlowable(width="100%", thickness=2, color=c_secondary, spaceBefore=4, spaceAfter=8))

    # --- DOCUMENT TITLE & METADATA BANNER ---
    banner_data = [
        [
            Paragraph("<b>DOCUMENT:</b> Cancellation, Doorstep Return & Instant Refund Policy", td_bold),
            Paragraph("<b>EFFECTIVE DATE:</b> November 16, 2026", td_style),
        ],
        [
            Paragraph("<b>LEGAL ENTITY:</b> eSakhi Marketplace Technologies Pvt. Ltd.", td_style),
            Paragraph("<b>JURISDICTION:</b> Damoh, Madhya Pradesh — 470661", td_style),
        ],
        [
            Paragraph("<b>PAYMENT PARTNER:</b> Razorpay Software Private Limited", td_style),
            Paragraph("<b>VERSION:</b> 2.4 (Hyperlocal Same-City DQC Compliant)", td_style),
        ],
    ]
    t_banner = Table(banner_data, colWidths=[260, 255])
    t_banner.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), c_bg_light),
        ('BOX', (0,0), (-1,-1), 1, c_secondary),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#FDE68A")),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(t_banner)
    story.append(Spacer(1, 10))

    # --- SECTION 1: OVERVIEW & SCOPE ---
    story.append(Paragraph("1. Purpose, Entity Identification & Scope", h1_style))
    story.append(Paragraph(
        "<b>Bazaar to Home</b> (“Platform”, “we”, “us”, “our”), operated by <b>eSakhi Marketplace Technologies Pvt. Ltd.</b>, "
        "is a dedicated hyperlocal digital marketplace connecting consumers in Damoh, Madhya Pradesh with registered nearby brick-and-mortar retail shops. "
        "This policy governs all orders, cancellations, returns, and refunds processed through our mobile application, web portal, and our integrated "
        "payment processing services powered by <b>Razorpay Software Private Limited</b>.",
        body_style
    ))
    story.append(Paragraph(
        "This policy is drafted in strict alignment with the <b>Consumer Protection Act, 2019</b>, the <b>Consumer Protection (E-Commerce) Rules, 2020</b>, "
        "and standard Razorpay Merchant Operating Guidelines. By placing an order via Bazaar to Home, the customer and seller mutually agree to the terms below.",
        body_style
    ))

    # --- SECTION 2: ORDER CANCELLATION POLICY ---
    story.append(Paragraph("2. Order Cancellation Policy (Customer & Merchant)", h1_style))
    story.append(Paragraph(
        "<b>2.1 Customer-Initiated Cancellations:</b><br/>"
        "• <b>Pre-Dispatch Window:</b> A customer can cancel their order free of charge at any time before the local shopkeeper accepts and packs the order (Order Status: <i>Placed</i> or <i>Acknowledged</i>). The full order amount including delivery fees is refunded 100% instantly.<br/>"
        "• <b>Post-Dispatch / Out for Delivery:</b> Once a delivery partner has been dispatched to pick up the order from the local shop, customer cancellation via the app is locked to prevent transit wastage. Customers can refuse handover at the doorstep upon arrival, subject to the Doorstep Quality Check protocol outlined in Section 3.",
        body_style
    ))
    story.append(Paragraph(
        "<b>2.2 Merchant-Initiated / System Cancellations:</b><br/>"
        "• If a local shopkeeper is unable to fulfil an order due to sudden stock depletion, shop closure, or emergency, the order is cancelled automatically.<br/>"
        "• In all merchant-initiated cancellations, a <b>100% full refund</b> (including all delivery and platform fees) is initiated immediately without any deductions.",
        body_style
    ))

    # --- SECTION 3: CORE HIGHLIGHT - SAME CITY DOORSTEP QUALITY CHECK (DQC) ---
    story.append(Paragraph("3. Intra-City Doorstep Delivery & Quality Check (DQC) Return Authorization", h1_style))
    
    callout_data = [[
        Paragraph(
            "<b>CORE OPERATIONAL DIRECTIVE (INTRA-CITY DAMOH FULFILMENT):</b><br/>"
            "Because all orders on Bazaar to Home originate and terminate within Damoh city limits, our verified <b>Delivery Partners are legally authorized agents</b> "
            "empowered to conduct a formal <b>Doorstep Quality Check (DQC)</b> at the customer's residence. The physical condition of the item is verified on the spot "
            "prior to return acceptance. If verified as intact, refund authorization is executed electronically immediately at the customer's doorstep.",
            callout_style
        )
    ]]
    t_callout = Table(callout_data, colWidths=[515])
    t_callout.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), c_accent_bg),
        ('BOX', (0,0), (-1,-1), 1, c_primary),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ]))
    story.append(t_callout)
    story.append(Spacer(1, 6))

    story.append(Paragraph(
        "<b>3.1 Verification Procedure by Authorized Delivery Partner:</b><br/>"
        "1. <b>Identity & Order Check:</b> The delivery partner matches the return request Order ID, seller dispatch tag, and product barcode/SKU.<br/>"
        "2. <b>Physical & Condition Inspection:</b> The partner examines the merchandise for intact security seals, original packaging, brand tags, and ensures goods are unwashed, unused, and undamaged.<br/>"
        "3. <b>Immediate Digital Signoff:</b> Once satisfied, the partner marks <i>DQC Verified: PASSED</i> on the Delivery Partner Cockpit app and takes a geo-tagged confirmation photo.<br/>"
        "4. <b>Instant Refund Trigger:</b> The partner's digital signoff immediately transmits an API trigger to the Razorpay / Banking payout engine, authorizing the customer's refund on the spot.",
        body_style
    ))
    story.append(Paragraph(
        "<b>3.2 Doorstep Rejection Criteria:</b> If an item shows signs of physical abuse, tampering, partial consumption (for food), missing accessories, or intentional swap, the delivery partner records <i>DQC: REJECTED</i> with photographic evidence. The return is declined, and the item remains with the customer with a detailed inspection report delivered via SMS.",
        body_style
    ))

    # --- SECTION 4: CATEGORY-WISE RETURN WINDOWS (TABLE) ---
    story.append(Paragraph("4. Category-Wise Return Windows & Eligibility Matrix", h1_style))
    story.append(Paragraph("Return windows vary depending on product perishability and hygiene standards of local shops:", body_style))

    cat_table_data = [
        [
            Paragraph("Category", th_style),
            Paragraph("Return Window", th_style),
            Paragraph("Accepted Return Grounds", th_style),
            Paragraph("DQC Verification Requirement", th_style),
        ],
        [
            Paragraph("<b>Fresh Dairy, Milk & Bakery</b><br/>(Cow Milk, Paneer, Curd, Fresh Bread)", td_style),
            Paragraph("<b>On-Delivery Inspection</b><br/>(Doorstep Open-Box)", td_style),
            Paragraph("Spoiled, curdled, leakage, broken pouch seal, incorrect quantity", td_style),
            Paragraph("Inspected at doorstep before rider departs. Not eligible once rider leaves.", td_style),
        ],
        [
            Paragraph("<b>Packaged Grocery & Staples</b><br/>(Atta, Dal, Oil, Spices, Ghee)", td_style),
            Paragraph("<b>48 Hours</b><br/>from delivery", td_style),
            Paragraph("Damaged packaging, expired product, wrong brand/variant received", td_style),
            Paragraph("Original brand packaging intact, seal unbroken, unconsumed.", td_style),
        ],
        [
            Paragraph("<b>Apparel & Handlooms</b><br/>(Sarees, Dupattas, Kurtas, Shawls)", td_style),
            Paragraph("<b>5 Days</b><br/>from delivery", td_style),
            Paragraph("Wrong size, manufacturing tear, color mismatch, stitching defect", td_style),
            Paragraph("Unused, unwashed, original tags attached, in polybag.", td_style),
        ],
        [
            Paragraph("<b>Local Sweets & Namkeen</b><br/>(Mawa Peda, Bundeli Snacks)", td_style),
            Paragraph("<b>24 Hours</b><br/>from delivery", td_style),
            Paragraph("Quality complaint, stale taste, damaged packaging box", td_style),
            Paragraph("Box contents mostly intact (>90%), verified against batch code.", td_style),
        ],
        [
            Paragraph("<b>Handicrafts & Utensils</b><br/>(Brass Diya, Home Decor, Pots)", td_style),
            Paragraph("<b>7 Days</b><br/>from delivery", td_style),
            Paragraph("Transit breakage, missing parts, surface dent, wrong item", td_style),
            Paragraph("Original packaging with protective wraps and bill present.", td_style),
        ],
    ]

    t_cat = Table(cat_table_data, colWidths=[120, 85, 160, 150])
    t_cat.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_primary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('GRID', (0,0), (-1,-1), 0.5, c_border),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor("#F9FAFB")]),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(t_cat)
    story.append(Spacer(1, 10))

    # --- SECTION 5: REFUND TIMELINES & PAYMENT MODES ---
    story.append(Paragraph("5. Refund Timelines, Payment Modes & Razorpay Processing SLA", h1_style))
    story.append(Paragraph(
        "All approved refunds are settled directly to the customer's original method of payment in compliance with "
        "<b>Reserve Bank of India (RBI)</b> digital payment settlement guidelines and <b>Razorpay Gateway SLA</b>:",
        body_style
    ))

    refund_table_data = [
        [
            Paragraph("Original Payment Mode", th_style),
            Paragraph("Refund Mode / Route", th_style),
            Paragraph("Refund Trigger Time", th_style),
            Paragraph("Expected Credit to Customer", th_style),
        ],
        [
            Paragraph("<b>UPI (PhonePe, GPay, Paytm)</b><br/>via Razorpay Gateway", td_style),
            Paragraph("Original UPI VPA / Linked Bank", td_style),
            Paragraph("Within <b>2 Hours</b> of DQC Approval", td_style),
            Paragraph("<b>Instant to 24 Hours</b><br/>(Depends on issuer bank NPCI rail)", td_style),
        ],
        [
            Paragraph("<b>Debit / Credit Card</b><br/>(Visa, Mastercard, RuPay)", td_style),
            Paragraph("Original Issuing Card Account", td_style),
            Paragraph("Within <b>2 to 12 Hours</b> of DQC Approval", td_style),
            Paragraph("<b>3 to 7 Business Days</b><br/>(Standard card network settlement cycle)", td_style),
        ],
        [
            Paragraph("<b>Net Banking</b><br/>(SBI, HDFC, ICICI, PNB, etc.)", td_style),
            Paragraph("Original Source Bank Account", td_style),
            Paragraph("Within <b>12 Hours</b> of DQC Approval", td_style),
            Paragraph("<b>2 to 5 Business Days</b><br/>(NEFT/IMPS clearing cycle)", td_style),
        ],
        [
            Paragraph("<b>Doorstep UPI / Cash on Delivery</b><br/>(Rider Digital Handover)", td_style),
            Paragraph("Customer's Verified UPI ID or Direct NEFT Payout", td_style),
            Paragraph("Within <b>2 Hours</b> of DQC Approval", td_style),
            Paragraph("<b>Instant (UPI)</b> or within 24 hours (NEFT) upon VPA confirmation", td_style),
        ],
    ]

    t_refund = Table(refund_table_data, colWidths=[130, 115, 120, 150])
    t_refund.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_primary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('GRID', (0,0), (-1,-1), 0.5, c_border),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor("#F9FAFB")]),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(t_refund)
    story.append(Spacer(1, 8))

    story.append(Paragraph(
        "<b>5.1 Razorpay Refund Reference Number (RRN):</b><br/>"
        "As soon as a refund is posted via Razorpay, the customer receives an automated SMS and email containing the <b>Razorpay Payment ID</b> and the unique <b>Bank RRN (Refund Reference Number)</b>. Customers can provide this RRN directly to their card issuer or bank branch for real-time tracking if credits do not reflect within the SLA.",
        body_style
    ))
    story.append(Paragraph(
        "<b>5.2 Zero Deductions on Legitimate Returns:</b><br/>"
        "Bazaar to Home charges <b>zero restocking fees</b>, zero reverse pickup charges, and zero processing deductions on approved returns. The full purchase consideration paid by the customer is restored.",
        body_style
    ))

    # --- SECTION 6: REPLACEMENTS & EXCHANGES ---
    story.append(Paragraph("6. Same-Day Replacements & Local Shop Exchange", h1_style))
    story.append(Paragraph(
        "Because our sellers operate within Damoh, customers can opt for an <b>Instant Replacement</b> instead of a monetary refund: "
        "<br/>• If milk curdled or a bakery loaf was delivered damaged, the rider can immediately pick up a replacement unit from the shop within 60–90 minutes."
        "<br/>• For apparel size exchanges (e.g. Medium to Large), the delivery partner conducts a simultaneous swap at the customer's doorstep.",
        body_style
    ))

    # --- SECTION 7: SELLER SHOP TOGGLE & PREVENTIVE QUALITY CONTROLS ---
    story.append(Paragraph("7. Shop Live Status & Closed Store Ordering Safeguards", h1_style))
    story.append(Paragraph(
        "To prevent order cancellations and unfulfilled deliveries:<br/>"
        "• All local shopkeepers have live access to toggle their store <b>Open / Closed</b>.<br/>"
        "• When a shopkeeper closes their physical shop (e.g. after 8:30 PM or for lunch), the platform automatically demotes their items and <b>intercepts checkout</b> with a clear operating schedule notice (e.g., <i>'Available, but shop is closed. Opens at 09:30 AM'</i>).<br/>"
        "• This preventive control eliminates unserviceable orders and protects both the customer and Razorpay payment authorization channels.",
        body_style
    ))

    # --- SECTION 8: GRIEVANCE REDRESSAL & STATUTORY COMPLIANCE ---
    story.append(Paragraph("8. Customer Support, Escalation Matrix & Grievance Redressal", h1_style))
    story.append(Paragraph(
        "In accordance with Rule 5(9) of the <b>Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021</b> "
        "and the <b>Consumer Protection (E-Commerce) Rules, 2020</b>, Bazaar to Home provides a dual-tier escalation matrix:",
        body_style
    ))

    contact_table_data = [
        [
            Paragraph("Escalation Tier", th_style),
            Paragraph("Contact Person / Channel", th_style),
            Paragraph("Operating SLA / TAT", th_style),
        ],
        [
            Paragraph("<b>Tier 1: Customer Care Desk</b><br/>(In-App & Email)", td_style),
            Paragraph("<b>Email:</b> support@bazaartohome.com<br/><b>Helpline:</b> +91-7812-290111<br/><b>In-App:</b> Live Chat in 'My Orders'", td_style),
            Paragraph("First Response: <b>Within 2 hours</b><br/>Resolution: Within 24 hours", td_style),
        ],
        [
            Paragraph("<b>Tier 2: Statutory Grievance Officer</b><br/>(Mandated under E-Commerce Rules)", td_style),
            Paragraph(
                "<b>Officer:</b> Grievance Redressal Officer<br/>"
                "<b>Entity:</b> eSakhi Marketplace Technologies Pvt. Ltd.<br/>"
                "<b>Address:</b> Bazaar to Home Central Hub, Station Road, Damoh, MP — 470661<br/>"
                "<b>Email:</b> grievance@bazaartohome.com",
                td_style
            ),
            Paragraph("Acknowledgement: <b>Within 48 hours</b><br/>Final Disposal: Within 30 days", td_style),
        ],
    ]

    t_contact = Table(contact_table_data, colWidths=[150, 235, 130])
    t_contact.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_primary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('GRID', (0,0), (-1,-1), 0.5, c_border),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor("#F9FAFB")]),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(t_contact)
    story.append(Spacer(1, 10))

    # --- SIGN-OFF & MERCHANT DECLARATION ---
    sign_data = [
        [
            Paragraph(
                "<b>MERCHANT UNDERTAKING FOR RAZORPAY PAYMENT GATEWAY ACTIVATION:</b><br/>"
                "We hereby certify that the above Return, Refund, and Cancellation Policy is actively published and enforced across the "
                "Bazaar to Home consumer web and mobile applications. All transactions processed via Razorpay follow the explicit settlement SLAs, "
                "Doorstep Quality Check verifications, and grievance timelines stipulated in this document.",
                callout_style
            )
        ],
        [
            Paragraph(
                "<b>Authorized Signatory:</b> For eSakhi Marketplace Technologies Pvt. Ltd. (Bazaar to Home)<br/>"
                "<b>Date of Execution:</b> November 16, 2026 | <b>Operating Base:</b> Damoh, Madhya Pradesh — 470661",
                td_bold
            )
        ]
    ]
    t_sign = Table(sign_data, colWidths=[515])
    t_sign.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), c_bg_light),
        ('BOX', (0,0), (-1,-1), 1, c_secondary),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ]))
    story.append(t_sign)

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated: {filename}")


if __name__ == '__main__':
    target_path = sys.argv[1] if len(sys.argv) > 1 else 'Bazaar_to_Home_Return_and_Refund_Policy.pdf'
    build_pdf(target_path)
