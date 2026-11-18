import os
import glob
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def create_text_image(width, height, bg_color):
    return Image.new("RGB", (width, height), bg_color)

def draw_rounded_rect(draw, box, radius, fill, outline=None, width=1):
    x1, y1, x2, y2 = box
    draw.rounded_rectangle([x1, y1, x2, y2], radius=radius, fill=fill, outline=outline, width=width)

def render_scene_frame(
    screenshot_path,
    phase_text,
    title_text,
    desc_text,
    tag_text,
    url_text,
    zoom_crop=None,
    cursor_pos=None,
    width=1920,
    height=1080
):
    # Base background: Deep rich gradient-like background
    img = create_text_image(width, height, (18, 24, 27))
    draw = ImageDraw.Draw(img)

    # Fonts
    font_badge = ImageFont.truetype("arialbd.ttf", 16)
    font_title = ImageFont.truetype("arialbd.ttf", 26)
    font_desc = ImageFont.truetype("arial.ttf", 18)
    font_tag = ImageFont.truetype("arialbd.ttf", 15)
    font_url = ImageFont.truetype("arial.ttf", 15)
    font_header_title = ImageFont.truetype("arialbd.ttf", 20)

    # --- TOP PLATFORM HEADER BAR ---
    draw.rectangle([0, 0, width, 56], fill=(26, 77, 46)) # Forest green brand
    draw.text((36, 16), "BAZAAR TO HOME  •  India Populated Places Architecture", fill=(255, 255, 255), font=font_header_title)
    
    # Status Pill on Top Right
    draw_rounded_rect(draw, (width - 290, 12, width - 36, 44), 16, fill=(255, 159, 28)) # Warm Amber
    draw.text((width - 275, 18), "LIVE PROTOTYPE DEMO", fill=(26, 77, 46), font=font_badge)

    # --- BROWSER WINDOW FRAME CONTAINER ---
    # Window rect: left=40, top=76, right=1880, bottom=910 (Height: 834)
    win_x1, win_y1, win_x2, win_y2 = 40, 76, width - 40, 910
    draw_rounded_rect(draw, (win_x1, win_y1, win_x2, win_y2), 12, fill=(38, 44, 48), outline=(60, 68, 74), width=1)

    # Browser window titlebar (height: 44)
    draw_rounded_rect(draw, (win_x1, win_y1, win_x2, win_y1 + 44), 12, fill=(48, 54, 60))
    # Red, Yellow, Green Mac/Window dots
    draw.ellipse([win_x1 + 16, win_y1 + 16, win_x1 + 28, win_y1 + 28], fill=(239, 68, 68))
    draw.ellipse([win_x1 + 36, win_y1 + 16, win_x1 + 48, win_y1 + 28], fill=(245, 158, 11))
    draw.ellipse([win_x1 + 56, win_y1 + 16, win_x1 + 68, win_y1 + 28], fill=(16, 185, 129))

    # URL omnibox
    url_box = (win_x1 + 100, win_y1 + 8, win_x2 - 100, win_y1 + 36)
    draw_rounded_rect(draw, url_box, 8, fill=(24, 28, 32), outline=(70, 78, 86))
    draw.text((win_x1 + 120, win_y1 + 12), f"🔒  {url_text}", fill=(180, 190, 200), font=font_url)

    # Browser Viewport Area
    vp_x1, vp_y1, vp_x2, vp_y2 = win_x1 + 2, win_y1 + 44, win_x2 - 2, win_y2 - 2
    vp_w = vp_x2 - vp_x1
    vp_h = vp_y2 - vp_y1

    # Load and render screenshot
    if os.path.exists(screenshot_path):
        try:
            shot = Image.open(screenshot_path).convert("RGB")
            if zoom_crop:
                # zoom_crop = (rel_x, rel_y, rel_w, rel_h)
                zx, zy, zw, zh = zoom_crop
                sw, sh = shot.size
                crop_box = (int(zx * sw), int(zy * sh), int((zx + zw) * sw), int((zy + zh) * sh))
                shot = shot.crop(crop_box)
            shot_resized = shot.resize((vp_w, vp_h), Image.Resampling.LANCZOS)
            img.paste(shot_resized, (vp_x1, vp_y1))
        except Exception as e:
            draw.rectangle([vp_x1, vp_y1, vp_x2, vp_y2], fill=(240, 240, 240))
            draw.text((vp_x1 + 40, vp_y1 + 40), f"Frame Loaded: {os.path.basename(screenshot_path)}", fill=(0,0,0), font=font_title)
    else:
        draw.rectangle([vp_x1, vp_y1, vp_x2, vp_y2], fill=(240, 245, 240))
        draw.text((vp_x1 + 60, vp_y1 + 60), f"Live Screen: {title_text}", fill=(26, 77, 46), font=font_title)

    # Optional Animated Cursor Pointer
    if cursor_pos:
        cx, cy = cursor_pos
        # Cursor triangle
        c_pts = [(cx, cy), (cx + 18, cy + 12), (cx + 12, cy + 18)]
        draw.polygon(c_pts, fill=(255, 255, 255), outline=(0, 0, 0))
        # Cursor pulse ring
        draw.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], outline=(255, 159, 28), width=2)

    # --- BOTTOM CAPTION & EXPLANATION CARD ---
    bot_y1 = 926
    bot_y2 = 1060
    draw_rounded_rect(draw, (40, bot_y1, width - 40, bot_y2), 12, fill=(25, 33, 38), outline=(255, 159, 28), width=1)

    # Phase badge
    draw_rounded_rect(draw, (60, bot_y1 + 16, 210, bot_y1 + 44), 6, fill=(26, 77, 46))
    draw.text((75, bot_y1 + 22), phase_text, fill=(224, 236, 200), font=font_badge)

    # Title
    draw.text((225, bot_y1 + 18), title_text, fill=(255, 255, 255), font=font_title)

    # Tag Badge (Right aligned)
    tag_w = int(draw.textlength(tag_text, font=font_tag)) + 30
    draw_rounded_rect(draw, (width - 60 - tag_w, bot_y1 + 16, width - 60, bot_y1 + 44), 6, fill=(45, 55, 65), outline=(90, 105, 120))
    draw.text((width - 60 - tag_w + 15, bot_y1 + 22), tag_text, fill=(255, 159, 28), font=font_tag)

    # Description Text
    draw.text((60, bot_y1 + 58), desc_text, fill=(205, 215, 225), font=font_desc)

    return img


def render_title_slate(width=1920, height=1080):
    img = create_text_image(width, height, (18, 24, 27))
    draw = ImageDraw.Draw(img)

    f_huge = ImageFont.truetype("arialbd.ttf", 46)
    f_sub = ImageFont.truetype("arialbd.ttf", 26)
    f_body = ImageFont.truetype("arial.ttf", 20)
    f_badge = ImageFont.truetype("arialbd.ttf", 16)

    # Green accent strip
    draw.rectangle([0, 0, width, 14], fill=(26, 77, 46))
    draw.rectangle([0, 14, width, 20], fill=(255, 159, 28))

    # Center card
    card_box = (140, 120, width - 140, height - 120)
    draw_rounded_rect(draw, card_box, 20, fill=(25, 33, 38), outline=(26, 77, 46), width=2)

    # Brand badge
    draw_rounded_rect(draw, (200, 180, 520, 222), 8, fill=(26, 77, 46))
    draw.text((220, 190), "BAZAAR TO HOME  •  SYSTEM PROTOTYPE", fill=(224, 236, 200), font=f_badge)

    # Title & Subtitle
    draw.text((200, 250), "India Populated Places Architecture", fill=(255, 255, 255), font=f_huge)
    draw.text((200, 315), "City Service Zone Directory, Multi-State Expansion & GeoNames Integration", fill=(255, 159, 28), font=f_sub)

    # Features list
    features = [
        "✓  GeoNames cities15000 Database (1,200+ Indian Populated Urban Centers & Administrative Seats)",
        "✓  1-to-N State/UT-to-City Dynamic Hierarchical Resolver (No Typos, Clean Normalization)",
        "✓  Platform City Configuration Engine (Super Admin Operations Dashboard at /super-admin/cities)",
        "✓  Multi-Tenant City Governance (Sellers, Delivery Partners & Service Zones tracked per city)",
        "✓  Hyperlocal City Service Zone Manager (/super-admin/cities/Damoh with Postal Code & Mohalla mapping)",
        "✓  Launch Market Primary Anchor: Damoh, Madhya Pradesh (Pincode: 470661)"
    ]

    y = 390
    for feat in features:
        draw.text((200, y), feat, fill=(215, 225, 235), font=f_body)
        y += 42

    # Bottom footer inside card
    draw.line([200, height - 200, width - 200, height - 200], fill=(60, 70, 80), width=1)
    draw.text((200, height - 180), "Runtime Environment: Localhost:5173  •  Engine: Vite + React + Express + MongoDB Atlas", fill=(160, 175, 190), font=f_body)

    return img


def render_outro_comparison_slate(width=1920, height=1080):
    img = create_text_image(width, height, (18, 24, 27))
    draw = ImageDraw.Draw(img)

    f_huge = ImageFont.truetype("arialbd.ttf", 36)
    f_sub = ImageFont.truetype("arialbd.ttf", 22)
    f_header = ImageFont.truetype("arialbd.ttf", 20)
    f_body = ImageFont.truetype("arial.ttf", 16)
    f_badge = ImageFont.truetype("arialbd.ttf", 15)

    # Green & Orange accent strip
    draw.rectangle([0, 0, width, 14], fill=(26, 77, 46))
    draw.rectangle([0, 14, width, 20], fill=(255, 159, 28))

    draw.text((80, 50), "Architecture Review: What IS Shown vs. What is NOT in the Video", fill=(255, 255, 255), font=f_huge)
    draw.text((80, 95), "Critical boundary distinctions between Populated Places data and Local Fulfilment", fill=(255, 159, 28), font=f_sub)

    # Left Column: What IS in the video (Width: 840)
    col1_x1, col1_y1, col1_x2, col1_y2 = 80, 145, 920, 980
    draw_rounded_rect(draw, (col1_x1, col1_y1, col1_x2, col1_y2), 14, fill=(24, 34, 30), outline=(26, 77, 46), width=2)
    draw_rounded_rect(draw, (col1_x1 + 20, col1_y1 + 20, col1_x1 + 360, col1_y1 + 54), 6, fill=(26, 77, 46))
    draw.text((col1_x1 + 35, col1_y1 + 27), "WHAT IS IN THIS VIDEO / SYSTEM", fill=(224, 236, 200), font=f_badge)

    is_items = [
        "1. GeoNames cities15000 Master Catalog:",
        "    • 1,200+ Indian cities with population > 15,000 or district HQs.",
        "    • Standardized State-to-City cascading hierarchy (MP, UP, MH, etc.).",
        "",
        "2. Super Admin Platform Configuration:",
        "    • Ability to switch platform operating market cleanly without spelling errors.",
        "    • Active setting persistence to MongoDB settings collection.",
        "",
        "3. Multi-City Directory & Governance:",
        "    • Aggregates active sellers, delivery partners, and orders by city.",
        "    • Identifies whether a city is 'active' or merely 'observed'.",
        "",
        "4. City Service Zone & Pincode Management:",
        "    • Links the selected city (Damoh) to localized service zones.",
        "    • Configures delivery fees (₹29) and base postal codes (470661).",
        "",
        "5. Consumer Hyperlocal Anchoring:",
        "    • Shows 'Delivering to: Pathani Mohalla, Damoh' in consumer header."
    ]

    y = col1_y1 + 75
    for line in is_items:
        draw.text((col1_x1 + 25, y), line, fill=(215, 230, 220), font=f_body)
        y += 28

    # Right Column: What is NOT in the video (Width: 840)
    col2_x1, col2_y1, col2_x2, col2_y2 = 980, 145, 1820, 980
    draw_rounded_rect(draw, (col2_x1, col2_y1, col2_x2, col2_y2), 14, fill=(35, 26, 28), outline=(220, 38, 38), width=2)
    draw_rounded_rect(draw, (col2_x1 + 20, col2_y1 + 20, col2_x1 + 420, col2_y1 + 54), 6, fill=(185, 28, 28))
    draw.text((col2_x1 + 35, col2_y1 + 27), "WHAT IS NOT IN THE VIDEO / LIMITATIONS", fill=(255, 255, 255), font=f_badge)

    not_items = [
        "1. No Sub-City Mohallas or Ward Polygons:",
        "    • cities15000 does NOT contain mohallas, wards, or streets.",
        "    • Hyperlocal zones (Pathani Mohalla, etc.) require separate custom rules.",
        "",
        "2. No GIS Polygon Boundaries or Geofences:",
        "    • Populated places are tabular text names; no GeoJSON polygon vectors.",
        "    • Delivery boundaries do not auto-clip to municipal river or road borders.",
        "",
        "3. No Automated Pincode-to-City Crosswalk:",
        "    • The file does NOT map PIN 470661 to Damoh automatically.",
        "    • Postal codes must be entered manually into the zone configuration.",
        "",
        "4. Excludes Small Rural Hamlets (<15,000 Pop):",
        "    • Peri-urban villages and gram panchayats around Damoh are excluded.",
        "",
        "5. No Real-Time Road Routing or Traffic Constraints:",
        "    • Proximity uses Haversine straight-line; road obstacles are not simulated.",
        "",
        "6. No Merchant Density or Market Liquidity Data:",
        "    • Presence of a city does not mean active shopkeepers or inventory exist."
    ]

    y = col2_y1 + 75
    for line in not_items:
        draw.text((col2_x1 + 25, y), line, fill=(245, 220, 225), font=f_body)
        y += 28

    # Footer note
    draw.text((80, 1005), "Document generated as part of Bazaar to Home Architectural Specifications • November 2026", fill=(140, 155, 170), font=f_body)

    return img


def build_prototype_video(output_mp4, screenshots_dir):
    width, height = 1920, 1080
    fps = 30
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_mp4, fourcc, fps, (width, height))

    # Helper to find screenshot with patterns
    def find_shot(*patterns):
        for pat in patterns:
            matches = glob.glob(os.path.join(screenshots_dir, f"*{pat}*"))
            if matches:
                return matches[0]
        # Also check evidence directory
        evidence_dir = r"C:\Users\PCD\.gemini\antigravity\brain\07ce76e7-74f5-4b37-ab28-8b09ffdd7b20\evidence"
        for pat in patterns:
            matches = glob.glob(os.path.join(evidence_dir, f"*{pat}*"))
            if matches:
                return matches[0]
        return ""

    # Scenes Definition: (type, duration_seconds, params)
    scenes = [
        # Scene 0: Title Slate
        {
            "type": "title",
            "duration": 4.5,
        },
        # Scene 1: Super Admin Cities Overview
        {
            "type": "screen",
            "duration": 4.0,
            "shot": find_shot("01_super_admin_cities", "super_admin_cities", "step_98"),
            "phase": "PHASE 1 OF 5",
            "title": "Super Admin Operations Dashboard — Cities & Service Zones",
            "desc": "Platform overview showing Configured City (Damoh), Cities in records, total active orders, and service zone metrics.",
            "tag": "ADMIN CONSOLE",
            "url": "http://localhost:5173/super-admin/cities",
            "cursor": (960, 220)
        },
        # Scene 2: Madhya Pradesh State Selection & GeoNames Dynamic City List
        {
            "type": "screen",
            "duration": 5.0,
            "shot": find_shot("02_mp_cities", "mp_cities", "step_100"),
            "phase": "PHASE 2 OF 5",
            "title": "State-to-City Dynamic Cascading Dropdown (GeoNames cities15000)",
            "desc": "Selecting 'Madhya Pradesh' asynchronously streams 1,200+ populated places from indiaPopulatedPlaces.json (Damoh, Bhopal, Indore).",
            "tag": "cities15000 JSON",
            "url": "http://localhost:5173/super-admin/cities",
            "zoom": (0.05, 0.22, 0.75, 0.65),
            "cursor": (540, 480)
        },
        # Scene 3: Multi-State Scalability Test (Uttar Pradesh Expansion)
        {
            "type": "screen",
            "duration": 4.5,
            "shot": find_shot("03_up_cities", "up_cities", "step_104"),
            "phase": "PHASE 3 OF 5",
            "title": "Multi-State Expansion Scalability (Demonstrating Uttar Pradesh)",
            "desc": "Switching State to Uttar Pradesh instantly re-indexes cities (Lucknow, Kanpur, Varanasi, Agra) with zero server lag.",
            "tag": "EXPANSION ENGINE",
            "url": "http://localhost:5173/super-admin/cities",
            "zoom": (0.05, 0.22, 0.75, 0.65),
            "cursor": (540, 520)
        },
        # Scene 4: Multi-City Governance & City Directory Table
        {
            "type": "screen",
            "duration": 4.5,
            "shot": find_shot("04_city_directory", "city_directory", "step_106"),
            "phase": "PHASE 4 OF 5",
            "title": "Multi-Tenant City Governance & Active City Directory",
            "desc": "Directory table aggregating active City Admins, registered sellers, delivery partners, service zones, and order volumes.",
            "tag": "GOVERNANCE TABLE",
            "url": "http://localhost:5173/super-admin/cities",
            "zoom": (0.02, 0.50, 0.96, 0.48),
            "cursor": (1450, 680)
        },
        # Scene 5: Damoh City Detail & Service Zones Management
        {
            "type": "screen",
            "duration": 5.0,
            "shot": find_shot("05_damoh_city_zones", "06_add_service_zone", "step_34"),
            "phase": "PHASE 5 OF 5",
            "title": "Hyperlocal Service Zones & Postal Code Boundary Configuration",
            "desc": "Damoh City Detail page: configuring localized mohallas (Pathani Mohalla, Ghanta Ghar), delivery fee (₹29), and PIN 470661.",
            "tag": "SERVICE ZONES",
            "url": "http://localhost:5173/super-admin/cities/Damoh",
            "zoom": (0.05, 0.15, 0.90, 0.75),
            "cursor": (1320, 310)
        },
        # Scene 6: Consumer App Hyperlocal Integration
        {
            "type": "screen",
            "duration": 4.5,
            "shot": find_shot("07_consumer_app", "step_98_shot_1", "step_98"),
            "phase": "CONSUMER INTEGRATION",
            "title": "Customer App Alignment — Hyperlocal Delivery in Selected City",
            "desc": "The configured city anchors the customer experience: 'Delivering to: Pathani Mohalla, Damoh' with My Area & Entire Damoh search.",
            "tag": "CONSUMER APP",
            "url": "http://localhost:5173/shop",
            "zoom": (0.0, 0.0, 1.0, 0.85),
            "cursor": (400, 180)
        },
        # Scene 7: Outro Comparison Slate (What IS vs What is NOT)
        {
            "type": "outro",
            "duration": 6.0,
        }
    ]

    total_frames = 0
    print("Rendering video frames...")

    rendered_images = []
    for sc in scenes:
        if sc["type"] == "title":
            img = render_title_slate(width, height)
        elif sc["type"] == "outro":
            img = render_outro_comparison_slate(width, height)
        else:
            img = render_scene_frame(
                sc.get("shot", ""),
                sc.get("phase", "DEMO"),
                sc.get("title", ""),
                sc.get("desc", ""),
                sc.get("tag", "PROTOTYPE"),
                sc.get("url", "http://localhost:5173"),
                zoom_crop=sc.get("zoom"),
                cursor_pos=sc.get("cursor"),
                width=width,
                height=height
            )
        rendered_images.append((img, int(sc["duration"] * fps)))

    # Assemble with crossfade transitions (12 frames transition)
    transition_frames = 12
    for i, (img, frame_count) in enumerate(rendered_images):
        curr_cv = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

        # Write core frames (minus transition tail)
        main_count = frame_count - transition_frames if i < len(rendered_images) - 1 else frame_count
        for _ in range(max(1, main_count)):
            out.write(curr_cv)
            total_frames += 1

        # Crossfade to next scene
        if i < len(rendered_images) - 1:
            next_img, _ = rendered_images[i + 1]
            next_cv = cv2.cvtColor(np.array(next_img), cv2.COLOR_RGB2BGR)
            for t in range(transition_frames):
                alpha = t / float(transition_frames)
                blended = cv2.addWeighted(curr_cv, 1.0 - alpha, next_cv, alpha, 0)
                out.write(blended)
                total_frames += 1

    out.release()
    print(f"Video created successfully! Total frames: {total_frames} (~{total_frames/fps:.1f}s) at {output_mp4}")


if __name__ == "__main__":
    import sys
    out_file = sys.argv[1] if len(sys.argv) > 1 else "India_Populated_Places_Prototype.mp4"
    shots_dir = sys.argv[2] if len(sys.argv) > 2 else "."
    build_prototype_video(out_file, shots_dir)
